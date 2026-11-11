import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Project, ProjectConfig } from '@shared/types'
import { assertPathWithinProject } from '../security/access-control'
import { atomicWriteFile } from '../io/atomic-file'

const MANIFEST = 'feicai-backup.json'
interface BackupManifest {
  format: 'feicai-project-backup'
  version: 1
  createdAt: string
  project: Pick<
    Project,
    'name' | 'visualStyle' | 'targetMedium' | 'totalEpisodes' | 'config'
  >
  files: Array<{ path: string; sha256: string; size: number }>
  directories: string[]
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  )
}

function safeRelativePath(root: string, entry: string): string {
  if (
    !entry ||
    isAbsolute(entry) ||
    entry.includes('\\') ||
    entry.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('备份包含无效的相对路径')
  }
  return assertPathWithinProject(root, join(root, entry))
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function copySnapshotFile(
  source: string,
  destination: string
): Promise<{ sha256: string; size: number }> {
  const before = await lstat(source)
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error('备份仅接受普通文件和目录，不接受符号链接')
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  const after = await lstat(source)
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino
  ) {
    throw new Error('备份期间项目文件发生变化，请停止编辑后重试')
  }
  return { sha256: await digest(destination), size: before.size }
}

export async function backupProjectFiles(
  project: Project,
  selectedDirectory: string
): Promise<string> {
  const sourceRoot = assertPathWithinProject(
    project.projectPath,
    project.projectPath
  )
  const destinationRoot = assertPathWithinProject(
    selectedDirectory,
    selectedDirectory
  )
  if (isWithin(sourceRoot, destinationRoot))
    throw new Error('备份位置不能位于源项目内部')
  const id = randomUUID()
  const temporary = join(destinationRoot, `.feicai-backup-${id}.tmp`)
  const destination = join(
    destinationRoot,
    `feicai-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`
  )
  await mkdir(join(temporary, 'files'), { recursive: true })
  const manifest: BackupManifest = {
    format: 'feicai-project-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    project: {
      name: project.name,
      visualStyle: project.visualStyle,
      targetMedium: project.targetMedium,
      totalEpisodes: project.totalEpisodes,
      config: project.config
    },
    files: [],
    directories: []
  }
  try {
    async function visit(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const source = assertPathWithinProject(
          sourceRoot,
          join(directory, entry.name)
        )
        const name = relative(sourceRoot, source).split(sep).join('/')
        if (entry.isSymbolicLink())
          throw new Error('项目含符号链接，不能创建可移植备份')
        if (entry.isDirectory()) {
          manifest.directories.push(name)
          await visit(source)
        } else {
          const metadata = await copySnapshotFile(
            source,
            safeRelativePath(join(temporary, 'files'), name)
          )
          manifest.files.push({ path: name, ...metadata })
        }
      }
    }
    await visit(sourceRoot)
    await atomicWriteFile(
      join(temporary, MANIFEST),
      JSON.stringify(manifest, null, 2)
    )
    await rename(temporary, destination)
    return destination
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

export async function restoreProjectFiles(
  backupDirectory: string,
  selectedDirectory: string
): Promise<{ path: string; project: BackupManifest['project'] }> {
  const root = assertPathWithinProject(backupDirectory, backupDirectory)
  const selected = assertPathWithinProject(selectedDirectory, selectedDirectory)
  if (isWithin(root, selected)) throw new Error('恢复位置不能位于备份内部')
  const raw = JSON.parse(
    await readFile(assertPathWithinProject(root, join(root, MANIFEST)), 'utf8')
  ) as Partial<BackupManifest>
  if (
    raw.format !== 'feicai-project-backup' ||
    raw.version !== 1 ||
    !raw.project ||
    !Array.isArray(raw.files) ||
    !Array.isArray(raw.directories)
  ) {
    throw new Error('不是受支持的 FEICAI 项目备份')
  }
  const project = raw.project
  if (
    typeof project.name !== 'string' ||
    !project.name.trim() ||
    typeof project.visualStyle !== 'string' ||
    typeof project.targetMedium !== 'string' ||
    !Number.isSafeInteger(project.totalEpisodes) ||
    project.totalEpisodes < 0 ||
    project.totalEpisodes > 10000 ||
    !project.config ||
    typeof project.config !== 'object'
  ) {
    throw new Error('备份项目元数据损坏')
  }
  const filesRoot = assertPathWithinProject(root, join(root, 'files'))
  const destination = join(
    selected,
    `feicai-restored-${randomUUID().slice(0, 8)}`
  )
  await mkdir(destination)
  try {
    const seen = new Set<string>()
    for (const directory of raw.directories) {
      if (typeof directory !== 'string') throw new Error('备份目录清单损坏')
      await mkdir(safeRelativePath(destination, directory), { recursive: true })
    }
    for (const entry of raw.files) {
      if (
        !entry ||
        typeof entry.path !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        seen.has(entry.path)
      )
        throw new Error('备份文件清单损坏或重复')
      seen.add(entry.path)
      const source = safeRelativePath(filesRoot, entry.path)
      const target = safeRelativePath(destination, entry.path)
      const copied = await copySnapshotFile(source, target)
      if (copied.sha256 !== entry.sha256 || copied.size !== entry.size)
        throw new Error(`备份完整性校验失败：${entry.path}`)
    }
    return {
      path: destination,
      project: { ...project, config: project.config as ProjectConfig }
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
