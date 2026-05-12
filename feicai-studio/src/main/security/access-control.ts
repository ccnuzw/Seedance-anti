import { existsSync, realpathSync } from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'

const registeredProjectRoots = new Set<string>()
const trustedDirectorySelections = new Set<string>()
const trustedFileSelections = new Set<string>()

function normalizePath(input: string): string {
  const resolved = resolve(input)
  const missingSegments: string[] = []
  let existingPath = resolved

  while (!existsSync(existingPath)) {
    const parentPath = dirname(existingPath)
    if (parentPath === existingPath) {
      return resolved
    }
    missingSegments.unshift(basename(existingPath))
    existingPath = parentPath
  }

  try {
    const normalizedExistingPath = realpathSync.native(existingPath)
    return missingSegments.reduce(
      (currentPath, segment) => join(currentPath, segment),
      normalizedExistingPath
    )
  } catch {
    return resolved
  }
}

function isInside(basePath: string, targetPath: string): boolean {
  const rel = relative(basePath, targetPath)
  return rel === '' || (!rel.startsWith('..') && rel !== '..')
}

function hasTrustedDirectory(targetPath: string): boolean {
  for (const basePath of trustedDirectorySelections) {
    if (isInside(basePath, targetPath)) return true
  }
  return false
}

function hasRegisteredProjectRoot(targetPath: string): boolean {
  for (const basePath of registeredProjectRoots) {
    if (isInside(basePath, targetPath)) return true
  }
  return false
}

export function rememberSelectedDirectory(dirPath: string): string {
  const normalized = normalizePath(dirPath)
  trustedDirectorySelections.add(normalized)
  return normalized
}

export function rememberSelectedFile(filePath: string): string {
  const normalized = normalizePath(filePath)
  trustedFileSelections.add(normalized)
  return normalized
}

export function registerProjectRoot(projectPath: string): string {
  const normalized = normalizePath(projectPath)
  registeredProjectRoots.add(normalized)
  return normalized
}

export function registerProjectRoots(projectPaths: string[]): void {
  for (const projectPath of projectPaths) {
    if (projectPath) registerProjectRoot(projectPath)
  }
}

export function assertTrustedProjectSelection(projectPath: string): string {
  const normalized = normalizePath(projectPath)
  if (!hasTrustedDirectory(normalized)) {
    throw new Error('该目录不是当前会话中经用户选择的项目目录')
  }
  return normalized
}

export function assertRegisteredProjectRoot(projectPath: string): string {
  const normalized = normalizePath(projectPath)
  if (!registeredProjectRoots.has(normalized)) {
    throw new Error('未授权访问该项目目录')
  }
  return normalized
}

export function assertProjectFileReadAllowed(filePath: string): string {
  const normalized = normalizePath(filePath)
  if (
    trustedFileSelections.has(normalized) ||
    hasTrustedDirectory(normalized) ||
    hasRegisteredProjectRoot(normalized)
  ) {
    return normalized
  }
  throw new Error('未授权读取该文件')
}

export function assertSelectedFileAllowed(filePath: string): string {
  const normalized = normalizePath(filePath)
  if (trustedFileSelections.has(normalized)) {
    return normalized
  }
  throw new Error('该文件不是当前会话中经用户选择的文件')
}

export function assertProjectFileWriteAllowed(filePath: string): string {
  const normalized = normalizePath(filePath)
  if (hasRegisteredProjectRoot(normalized)) {
    return normalized
  }
  throw new Error('未授权写入该文件')
}
