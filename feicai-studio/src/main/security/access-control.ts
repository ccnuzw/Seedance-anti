import { lstatSync, realpathSync } from 'fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'path'

// Capabilities are granted only by native dialogs or the registered project list.
const registeredProjectRoots = new Map<string, string>()
const trustedDirectorySelections = new Map<string, string>()
const trustedFileSelections = new Map<string, string>()

export function assertNonEmptyString(
  value: unknown,
  label = '参数'
): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new Error(`${label}必须为非空字符串`)
  }
}

export function assertEpisodeNumber(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 10000
  ) {
    throw new Error('集数必须为1至10000的正整数')
  }
}

export function isMissingFileError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/** Canonicalize only macOS's verified, fixed system aliases, not project links. */
export function normalizeSystemPathAliases(path: string): string {
  if (process.platform === 'darwin') {
    for (const alias of ['/var', '/tmp']) {
      if (
        (path === alias || path.startsWith(`${alias}/`)) &&
        realpathSync.native(alias) === `/private${alias}`
      )
        return `/private${path}`
    }
  }
  return path
}

function absolutePath(input: unknown): string {
  assertNonEmptyString(input, '路径')
  if (!isAbsolute(input)) throw new Error('路径必须为绝对路径')
  return normalizeSystemPathAliases(resolve(input))
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  )
}

function canonicalDirectory(input: string): string {
  const path = absolutePath(input)
  let current = parse(path).root
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink())
      throw new Error('禁止将符号链接用作项目目录或其父目录')
  }
  const canonical = realpathSync.native(path)
  const stat = lstatSync(canonical)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('项目路径必须为真实目录')
  return canonical
}

/** Validate the final path without following even dangling symlinks. Missing
 * ordinary descendants are allowed so callers can safely create new files. */
export function assertPathWithinProject(
  projectPath: string,
  filePath: string
): string {
  const requestedRoot = absolutePath(projectPath)
  const root = canonicalDirectory(requestedRoot)
  const requested = absolutePath(filePath)
  let target: string
  if (isInside(requestedRoot, requested)) {
    target = join(root, relative(requestedRoot, requested))
  } else if (isInside(root, requested)) {
    target = requested
  } else {
    throw new Error('路径不在项目目录内')
  }

  let current = root
  const parts = relative(root, target).split(sep).filter(Boolean)
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index])
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('禁止访问符号链接')
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new Error('父路径不是目录')
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      // lstat (unlike existsSync) reports dangling links as links, not missing.
      break
    }
  }
  return target
}

function rememberDirectory(
  input: string,
  capabilities: Map<string, string>
): string {
  const requested = absolutePath(input)
  const canonical = canonicalDirectory(requested)
  capabilities.set(requested, canonical)
  capabilities.set(canonical, canonical)
  return canonical
}

function assertDirectoryCapability(
  input: string,
  capabilities: Map<string, string>,
  message: string
): string {
  const requested = absolutePath(input)
  const granted = capabilities.get(requested)
  if (!granted || canonicalDirectory(requested) !== granted)
    throw new Error(message)
  return granted
}

export function rememberSelectedDirectory(dirPath: string): string {
  return rememberDirectory(dirPath, trustedDirectorySelections)
}

export function rememberSelectedFile(filePath: string): string {
  const requested = absolutePath(filePath)
  canonicalDirectory(dirname(requested))
  const stat = lstatSync(requested)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('只能选择普通文件')
  const canonical = realpathSync.native(requested)
  trustedFileSelections.set(requested, canonical)
  trustedFileSelections.set(canonical, canonical)
  return canonical
}

export function registerProjectRoot(projectPath: string): string {
  return rememberDirectory(projectPath, registeredProjectRoots)
}

export function registerProjectRoots(projectPaths: string[]): void {
  for (const projectPath of projectPaths) {
    try {
      registerProjectRoot(projectPath)
    } catch (error) {
      // Keep offline/deleted project records visible without granting a root.
      if (!isMissingFileError(error)) throw error
    }
  }
}

export function unregisterProjectRoot(projectPath: string): void {
  const canonical = registeredProjectRoots.get(absolutePath(projectPath))
  for (const [alias, granted] of registeredProjectRoots) {
    if (granted === canonical) registeredProjectRoots.delete(alias)
  }
}

export function assertTrustedProjectSelection(projectPath: string): string {
  // Selecting a folder does not grant all its descendants as projects.
  return assertDirectoryCapability(
    projectPath,
    trustedDirectorySelections,
    '该目录不是当前会话中经用户选择的项目目录'
  )
}

export function assertRegisteredProjectRoot(projectPath: string): string {
  return assertDirectoryCapability(
    projectPath,
    registeredProjectRoots,
    '未授权访问该项目目录'
  )
}

function assertRegisteredFile(filePath: string, message: string): string {
  const requested = absolutePath(filePath)
  for (const [alias, root] of registeredProjectRoots) {
    if (isInside(alias, requested)) {
      if (canonicalDirectory(alias) !== root) throw new Error(message)
      return assertPathWithinProject(alias, requested)
    }
  }
  throw new Error(message)
}

export function assertSelectedFileAllowed(filePath: string): string {
  const requested = absolutePath(filePath)
  const granted = trustedFileSelections.get(requested)
  if (!granted) throw new Error('该文件不是当前会话中经用户选择的文件')
  canonicalDirectory(dirname(requested))
  const stat = lstatSync(requested)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync.native(requested) !== granted
  ) {
    throw new Error('选定文件已变更为不安全路径')
  }
  return granted
}

export function assertProjectFileReadAllowed(filePath: string): string {
  const requested = absolutePath(filePath)
  if (trustedFileSelections.has(requested))
    return assertSelectedFileAllowed(requested)
  // A selected directory is only an import capability, never a generic read grant.
  return assertRegisteredFile(requested, '未授权读取该文件')
}

export function assertProjectFileWriteAllowed(filePath: string): string {
  return assertRegisteredFile(filePath, '未授权写入该文件')
}

export function resetAccessControl(): void {
  registeredProjectRoots.clear()
  trustedDirectorySelections.clear()
  trustedFileSelections.clear()
}

export function refreshRegisteredProjectRoots(projectPaths: string[]): void {
  registeredProjectRoots.clear()
  registerProjectRoots(projectPaths)
}

export function isSameProjectRoot(
  projectPath: string,
  canonicalRoot: string
): boolean {
  try {
    return canonicalDirectory(projectPath) === absolutePath(canonicalRoot)
  } catch (error) {
    if (isMissingFileError(error)) return false
    throw error
  }
}
