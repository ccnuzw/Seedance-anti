import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { mkdir, open, rename, unlink } from 'fs/promises'
import { dirname, join, parse, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import {
  isMissingFileError,
  normalizeSystemPathAliases
} from '../security/access-control'

const pending = new Map<string, Promise<void>>()

/** Reject links in every existing component, including dangling final links. */
export function assertNoLinkedPath(filePath: string): string {
  const target = normalizeSystemPathAliases(resolve(filePath))
  let current = parse(target).root
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error('禁止访问符号链接')
    } catch (error) {
      if (isMissingFileError(error)) break
      throw error
    }
  }
  return target
}

export async function readRegularFile(filePath: string): Promise<Buffer> {
  const target = assertNoLinkedPath(filePath)
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await file.stat()).isFile()) throw new Error('只能读取普通文件')
    return await file.readFile()
  } finally {
    await file.close()
  }
}

function tempPath(filePath: string): string {
  return join(dirname(filePath), `.${parse(filePath).base}.${randomUUID()}.tmp`)
}

function validPreviousContent(filePath: string, content: Buffer): boolean {
  if (!filePath.toLowerCase().endsWith('.json')) return true
  try {
    JSON.parse(content.toString('utf8'))
    return true
  } catch {
    console.warn(`保留现有备份：主JSON文件已损坏 (${filePath})`)
    return false
  }
}

async function syncDirectory(filePath: string): Promise<void> {
  const directory = await open(dirname(filePath), constants.O_RDONLY)
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

async function replaceFile(
  filePath: string,
  content: string | Buffer,
  beforeRename?: () => Promise<void>
): Promise<void> {
  assertNoLinkedPath(filePath)
  const temporary = tempPath(filePath)
  const file = await open(
    temporary,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile(content)
    await file.sync()
  } catch (error) {
    await file.close()
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  await file.close()
  try {
    assertNoLinkedPath(filePath)
    if (beforeRename) await beforeRename()
    assertNoLinkedPath(filePath)
    await rename(temporary, filePath)
    await syncDirectory(filePath)
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error
    })
  }
}

async function commit(
  filePath: string,
  content: string | Buffer,
  expectedContent?: string | null
): Promise<void> {
  assertNoLinkedPath(filePath)
  await mkdir(dirname(filePath), { recursive: true })
  assertNoLinkedPath(filePath)
  let previous: Buffer | null = null
  try {
    previous = await readRegularFile(filePath)
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }
  if (
    expectedContent !== undefined &&
    (previous?.toString('utf8') ?? null) !== expectedContent
  )
    throw new FileConflictError()
  if (previous !== null && validPreviousContent(filePath, previous))
    await replaceFile(`${filePath}.bak`, previous)
  const checkExternalChange =
    expectedContent === undefined
      ? undefined
      : async (): Promise<void> => {
          let current: string | null = null
          try {
            current = (await readRegularFile(filePath)).toString('utf8')
          } catch (error) {
            if (!isMissingFileError(error)) throw error
          }
          if (current !== expectedContent) throw new FileConflictError()
        }
  await replaceFile(filePath, content, checkExternalChange)
}

function enqueue(
  filePath: string,
  operation: (target: string) => Promise<void>
): Promise<void> {
  const target = assertNoLinkedPath(filePath)
  const previous = pending.get(target) || Promise.resolve()
  const result = previous.catch(() => undefined).then(() => operation(target))
  pending.set(target, result)
  void result.then(
    () => {
      if (pending.get(target) === result) pending.delete(target)
    },
    () => {
      if (pending.get(target) === result) pending.delete(target)
    }
  )
  return result
}

export async function atomicWriteFile(
  filePath: string,
  content: string
): Promise<void> {
  return enqueue(filePath, (target) => commit(target, content))
}

export class FileConflictError extends Error {
  constructor() {
    super('FILE_CONFLICT')
    this.name = 'FileConflictError'
  }
}

export async function atomicCompareAndWriteFile(
  filePath: string,
  content: string,
  expectedContent: string | null
): Promise<void> {
  return enqueue(filePath, (target) => commit(target, content, expectedContent))
}

export async function atomicCopyFile(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  return enqueue(destinationPath, async (target) =>
    commit(target, await readRegularFile(sourcePath))
  )
}

/** Synchronous stores cannot wait for an asynchronous writer without deadlock. */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const target = assertNoLinkedPath(filePath)
  if (pending.has(target)) throw new Error('该文件仍有异步写入，不能同步覆盖')
  mkdirSync(dirname(target), { recursive: true })
  assertNoLinkedPath(target)
  const replace = (destination: string, value: string | Buffer): void => {
    assertNoLinkedPath(destination)
    const temporary = tempPath(destination)
    const file = openSync(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    )
    try {
      writeFileSync(file, value)
      fsyncSync(file)
    } catch (error) {
      closeSync(file)
      try {
        unlinkSync(temporary)
      } catch (cleanup) {
        if (!isMissingFileError(cleanup)) throw cleanup
      }
      throw error
    }
    closeSync(file)
    try {
      assertNoLinkedPath(destination)
      renameSync(temporary, destination)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch (cleanup) {
        if (!isMissingFileError(cleanup))
          throw new AggregateError(
            [error, cleanup],
            '原子替换及临时文件清理失败'
          )
      }
      throw error
    }
  }
  try {
    const existing = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    let previous: Buffer
    try {
      previous = readFileSync(existing)
    } finally {
      closeSync(existing)
    }
    if (validPreviousContent(target, previous))
      replace(`${target}.bak`, previous)
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }
  replace(target, content)
  const directory = openSync(dirname(target), constants.O_RDONLY)
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

export async function flushPendingWrites(): Promise<void> {
  const failures: unknown[] = []
  while (pending.size) {
    const results = await Promise.allSettled([...pending.values()])
    for (const result of results)
      if (result.status === 'rejected') failures.push(result.reason)
  }
  if (failures.length) throw new AggregateError(failures, '原子文件写入失败')
}

export async function readJsonWithRecovery<T>(
  filePath: string
): Promise<T | null> {
  let result: T | null = null
  await enqueue(filePath, async (target) => {
    let primaryError: unknown
    try {
      result = JSON.parse((await readRegularFile(target)).toString('utf8')) as T
      return
    } catch (error) {
      primaryError = error
      if (!(error instanceof SyntaxError) && !isMissingFileError(error))
        throw error
    }
    let backup: string
    try {
      backup = (await readRegularFile(`${target}.bak`)).toString('utf8')
    } catch (error) {
      if (isMissingFileError(error) && isMissingFileError(primaryError)) return
      throw new AggregateError(
        [primaryError, error],
        `无法读取主文件及备份: ${target}`
      )
    }
    try {
      result = JSON.parse(backup) as T
    } catch (error) {
      throw new AggregateError(
        [primaryError, error],
        `主文件和备份均已损坏: ${target}`
      )
    }
    await commit(target, backup)
    console.warn(`主文件缺失或损坏，已从备份恢复: ${target}`)
  })
  return result
}
