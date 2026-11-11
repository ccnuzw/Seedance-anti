// ============================================================
// SQLite 数据库初始化与管理
// ============================================================

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { migrateDatabase } from './migrations'

let db: Database.Database | null = null

/**
 * 初始化数据库
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')
  mkdirSync(dbDir, { recursive: true })
  const dbPath = join(dbDir, 'feicai.db')

  const candidate = new Database(dbPath)
  try {
    candidate.pragma('journal_mode = WAL')
    candidate.pragma('foreign_keys = ON')
    migrateDatabase(candidate)
    // Publish only fully initialized connections; failed opens must be retryable.
    db = candidate
    return db
  } catch (error) {
    candidate.close()
    throw error
  }
}

/**
 * 获取数据库实例
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()')
  }
  return db
}

/**
 * 关闭数据库
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
