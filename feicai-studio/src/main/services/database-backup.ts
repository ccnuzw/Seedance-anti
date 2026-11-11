import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { getDatabase } from '../db/database'
import { assertPathWithinProject } from '../security/access-control'

const TABLES = [
  'projects',
  'episodes',
  'characters',
  'scenes',
  'asset_references',
  'reviews',
  'llm_configs',
  'execution_logs'
] as const

export async function backupDatabaseFile(destination: string): Promise<void> {
  const current = resolve(getDatabase().name)
  if (
    [current, `${current}-wal`, `${current}-shm`].includes(resolve(destination))
  ) {
    throw new Error('不能覆盖正在使用的数据库及其日志文件')
  }
  const parent = dirname(destination)
  assertPathWithinProject(parent, destination)
  const temporary = join(parent, `.feicai-db-${randomUUID()}.tmp`)
  try {
    await getDatabase().backup(temporary)
    await chmod(temporary, 0o600)
    assertPathWithinProject(parent, destination)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function restoreDatabaseFile(source: string): Promise<number> {
  const database = getDatabase()
  if (resolve(source) === resolve(database.name))
    throw new Error('不能将当前正在使用的数据库作为恢复来源')
  assertPathWithinProject(dirname(source), source)
  if (!(await lstat(source)).isFile())
    throw new Error('请选择普通 SQLite 备份文件')
  const backup = new Database(source, { readonly: true, fileMustExist: true })
  const columns = new Map<string, string[]>()
  try {
    if (backup.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('数据库备份完整性校验失败')
    for (const table of TABLES) {
      const sourceTable = backup
        .prepare('SELECT type FROM sqlite_master WHERE name = ?')
        .get(table) as { type: string } | undefined
      if (sourceTable?.type !== 'table')
        throw new Error(`备份缺少数据表：${table}`)
      const current = database
        .prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<{ name: string }>
      const incoming = backup
        .prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<{ name: string }>
      const incomingNames = new Set(incoming.map((column) => column.name))
      if (
        current.length !== incoming.length ||
        current.some((column) => !incomingNames.has(column.name))
      ) {
        throw new Error('备份数据库版本与当前应用不一致，请使用相同版本恢复')
      }
      columns.set(
        table,
        current.map((column) => column.name)
      )
    }
    const incomingViolations = backup.pragma('foreign_key_check')
    if (!Array.isArray(incomingViolations) || incomingViolations.length)
      throw new Error('备份含损坏的关联记录')
  } finally {
    backup.close()
  }
  const rollbackPath = join(
    dirname(database.name),
    `before-restore-${Date.now()}.sqlite`
  )
  await backupDatabaseFile(rollbackPath)
  database.prepare('ATTACH DATABASE ? AS recovery').run(source)
  const foreignKeys = database.pragma('foreign_keys', { simple: true })
  database.pragma('foreign_keys = OFF')
  try {
    return database.transaction(() => {
      for (const table of [...TABLES].reverse())
        database.exec(`DELETE FROM "${table}"`)
      for (const table of TABLES) {
        const names = columns
          .get(table)!
          .map((name) => `"${name.replace(/"/g, '""')}"`)
          .join(', ')
        database.exec(
          `INSERT INTO main."${table}" (${names}) SELECT ${names} FROM recovery."${table}"`
        )
      }
      const restoredViolations = database.pragma('foreign_key_check')
      if (!Array.isArray(restoredViolations) || restoredViolations.length)
        throw new Error('恢复后关联校验失败，已撤回更改')
      const row = database
        .prepare<[], { count: number }>(
          'SELECT COUNT(*) AS count FROM projects'
        )
        .get()
      if (!row) throw new Error('恢复后项目统计失败')
      return row.count
    })()
  } finally {
    database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
    database.exec('DETACH DATABASE recovery')
  }
}
