// ============================================================
// SQLite 数据库初始化与管理
// ============================================================

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database | null = null

const SCHEMA = `
-- 项目
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT DEFAULT 'script',
  phase TEXT DEFAULT 'production',
  visual_style TEXT,
  target_medium TEXT,
  project_path TEXT NOT NULL,
  total_episodes INTEGER DEFAULT 0,
  novel_title TEXT,
  novel_genre TEXT,
  config_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 集数
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  episode_number INTEGER NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'idle',
  script_path TEXT,
  director_analysis_path TEXT,
  art_design_path TEXT,
  seedance_prompts_path TEXT,
  has_script BOOLEAN DEFAULT 0,
  has_director BOOLEAN DEFAULT 0,
  has_art BOOLEAN DEFAULT 0,
  has_prompts BOOLEAN DEFAULT 0,
  total_duration_seconds REAL,
  total_prompts INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, episode_number)
);

-- 角色素材
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  alias TEXT,
  age TEXT,
  appearance TEXT,
  prompt_text TEXT,
  reference_image_path TEXT,
  first_episode INTEGER,
  is_variant BOOLEAN DEFAULT 0,
  variant_of TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 场景素材
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  time_of_day TEXT,
  lighting TEXT,
  atmosphere TEXT,
  prompt_text TEXT,
  reference_image_path TEXT,
  grid_source TEXT,
  grid_position INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 素材引用关系
CREATE TABLE IF NOT EXISTS asset_references (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  prompt_index INTEGER NOT NULL,
  asset_type TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  reference_tag TEXT NOT NULL
);

-- 审核记录
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  stage TEXT NOT NULL,
  review_type TEXT NOT NULL,
  score REAL,
  result TEXT NOT NULL,
  feedback TEXT,
  issues_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- LLM 配置
CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'llm',
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  max_tokens INTEGER DEFAULT 8192,
  temperature REAL DEFAULT 0.7,
  is_default BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 执行日志
CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  details_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_episode ON reviews(episode_id);
CREATE INDEX IF NOT EXISTS idx_logs_episode ON execution_logs(episode_id);
CREATE INDEX IF NOT EXISTS idx_refs_episode ON asset_references(episode_id);

-- 小说信息（编剧管线）
CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  genre TEXT,
  total_chapters INTEGER DEFAULT 0,
  chapters_dir TEXT,
  processed_chapters INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 剧情拆解批次（编剧管线）
CREATE TABLE IF NOT EXISTS adapt_batches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  batch_number INTEGER NOT NULL,
  chapter_start INTEGER NOT NULL,
  chapter_end INTEGER NOT NULL,
  plot_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  review_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 剧情点（编剧管线）
CREATE TABLE IF NOT EXISTS plot_points (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  batch_id TEXT REFERENCES adapt_batches(id),
  plot_number INTEGER NOT NULL,
  scene TEXT,
  description TEXT,
  hook_type TEXT,
  episode_number INTEGER,
  status TEXT DEFAULT 'unused',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_novels_project ON novels(project_id);
CREATE INDEX IF NOT EXISTS idx_batches_project ON adapt_batches(project_id);
CREATE INDEX IF NOT EXISTS idx_plots_project ON plot_points(project_id);
CREATE INDEX IF NOT EXISTS idx_plots_batch ON plot_points(batch_id);
`

/**
 * 初始化数据库
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')
  mkdirSync(dbDir, { recursive: true })
  const dbPath = join(dbDir, 'feicai.db')

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  // === 迁移：为已有数据库添加新列 ===
  const columns = db.prepare("PRAGMA table_info('episodes')").all() as { name: string }[]
  const colNames = new Set(columns.map(c => c.name))

  const migrations: [string, string][] = [
    ['art_design_path', 'ALTER TABLE episodes ADD COLUMN art_design_path TEXT'],
    ['has_script', 'ALTER TABLE episodes ADD COLUMN has_script BOOLEAN DEFAULT 0'],
    ['has_director', 'ALTER TABLE episodes ADD COLUMN has_director BOOLEAN DEFAULT 0'],
    ['has_art', 'ALTER TABLE episodes ADD COLUMN has_art BOOLEAN DEFAULT 0'],
    ['has_prompts', 'ALTER TABLE episodes ADD COLUMN has_prompts BOOLEAN DEFAULT 0'],
  ]
  for (const [col, sql] of migrations) {
    if (!colNames.has(col)) db.exec(sql)
  }

  // === 迁移：llm_configs 增加 category 列 ===
  const llmCols = db.prepare("PRAGMA table_info('llm_configs')").all() as { name: string }[]
  const llmColNames = new Set(llmCols.map(c => c.name))
  if (!llmColNames.has('category')) {
    db.exec("ALTER TABLE llm_configs ADD COLUMN category TEXT DEFAULT 'llm'")
  }

  // === 迁移：projects 增加 source_type / phase / novel_title / novel_genre 列 ===
  const projCols = db.prepare("PRAGMA table_info('projects')").all() as { name: string }[]
  const projColNames = new Set(projCols.map(c => c.name))
  const projMigrations: [string, string][] = [
    ['source_type', "ALTER TABLE projects ADD COLUMN source_type TEXT DEFAULT 'script'"],
    ['phase', "ALTER TABLE projects ADD COLUMN phase TEXT DEFAULT 'production'"],
    ['novel_title', 'ALTER TABLE projects ADD COLUMN novel_title TEXT'],
    ['novel_genre', 'ALTER TABLE projects ADD COLUMN novel_genre TEXT'],
  ]
  for (const [col, sql] of projMigrations) {
    if (!projColNames.has(col)) db.exec(sql)
  }

  return db
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
