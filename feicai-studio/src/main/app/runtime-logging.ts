import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface RuntimeLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  scope: 'startup' | 'runtime'
  message: string
}

const recentErrors: RuntimeLogEntry[] = []

function ensureLogsDir(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getRuntimeLogPath(): string {
  return join(ensureLogsDir(), 'app-runtime.log')
}

export function getRuntimeLogsDir(): string {
  return ensureLogsDir()
}

export function logRuntimeEvent(entry: RuntimeLogEntry): void {
  const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}\n`
  try {
    appendFileSync(getRuntimeLogPath(), line, 'utf-8')
  } catch {
    // 忽略日志写入失败，避免影响主流程
  }

  if (entry.level === 'error') {
    recentErrors.unshift(entry)
    if (recentErrors.length > 20) {
      recentErrors.length = 20
    }
  }
}

export function getRecentRuntimeErrors(): RuntimeLogEntry[] {
  return [...recentErrors]
}
