import { isAbsolute, relative, resolve } from 'path'
import { listProjectPaths } from '../db/queries'

const sessionGrantedPaths = new Set<string>()

function normalizePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('路径无效')
  }
  return resolve(inputPath)
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isAllowedPath(targetPath: string): boolean {
  const resolvedTarget = normalizePath(targetPath)
  const allowedRoots = new Set<string>()

  for (const grantedPath of sessionGrantedPaths) {
    allowedRoots.add(grantedPath)
  }

  for (const projectPath of listProjectPaths()) {
    allowedRoots.add(normalizePath(projectPath))
  }

  for (const allowedRoot of allowedRoots) {
    if (isPathInsideRoot(resolvedTarget, allowedRoot)) {
      return true
    }
  }

  return false
}

export function grantPathAccess(inputPath: string): string {
  const resolvedPath = normalizePath(inputPath)
  sessionGrantedPaths.add(resolvedPath)
  return resolvedPath
}

export function assertPathAccess(inputPath: string): string {
  const resolvedPath = normalizePath(inputPath)
  if (!isAllowedPath(resolvedPath)) {
    throw new Error(`拒绝访问未授权路径: ${resolvedPath}`)
  }
  return resolvedPath
}

export function assertProjectPathAccess(projectPath: string): string {
  return assertPathAccess(projectPath)
}
