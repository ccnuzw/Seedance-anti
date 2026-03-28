// ============================================================
// SQLite 数据库初始化与管理
// ============================================================

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

let db: Database.Database | null = null
let dbFilePath: string | null = null

const SCHEMA = `
-- 项目
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT DEFAULT 'script',
  phase TEXT DEFAULT 'production',
  visual_style TEXT,
  target_medium TEXT,
  project_path TEXT NOT NULL UNIQUE,
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

-- 流水线运行记录
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  project_path TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  current_stage TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  single_stage BOOLEAN DEFAULT 0,
  queued_at DATETIME NOT NULL,
  started_at DATETIME,
  ended_at DATETIME,
  last_updated_at DATETIME NOT NULL,
  queue_position INTEGER,
  error_message TEXT,
  payload_json TEXT,
  batch_id TEXT,
  batch_label TEXT,
  priority TEXT DEFAULT 'normal',
  max_auto_retries INTEGER DEFAULT 0,
  attempt INTEGER DEFAULT 0,
  root_run_id TEXT,
  worker_slot INTEGER,
  archived_at DATETIME,
  depends_on_root_run_id TEXT,
  trigger_condition TEXT DEFAULT 'always',
  scheduled_at DATETIME,
  template_id TEXT,
  template_label TEXT,
  schedule_id TEXT,
  schedule_label TEXT,
  automation_key TEXT
  ,
  dead_lettered_at DATETIME,
  recovery_note TEXT,
  llm_call_count INTEGER DEFAULT 0,
  llm_success_count INTEGER DEFAULT 0,
  llm_failure_count INTEGER DEFAULT 0,
  llm_input_tokens INTEGER DEFAULT 0,
  llm_output_tokens INTEGER DEFAULT 0,
  llm_total_tokens INTEGER DEFAULT 0,
  llm_estimated_cost_usd REAL DEFAULT 0,
  llm_total_duration_ms INTEGER DEFAULT 0,
  llm_last_provider TEXT,
  llm_last_model TEXT,
  llm_last_failure_class TEXT,
  llm_last_called_at DATETIME
);

CREATE TABLE IF NOT EXISTS pipeline_run_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id),
  stage TEXT NOT NULL,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_run_llm_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id),
  stage TEXT NOT NULL,
  phase TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  stream BOOLEAN DEFAULT 0,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_ms INTEGER DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  token_source TEXT,
  estimated_cost_usd REAL,
  failure_class TEXT,
  error_message TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_episode ON reviews(episode_id);
CREATE INDEX IF NOT EXISTS idx_logs_episode ON execution_logs(episode_id);
CREATE INDEX IF NOT EXISTS idx_refs_episode ON asset_references(episode_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project_episode ON pipeline_runs(project_id, episode_number, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status, priority, queue_position, queued_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_strategy_status ON pipeline_runs(status, priority, queue_position, queued_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_archived ON pipeline_runs(archived_at, last_updated_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_orchestration ON pipeline_runs(depends_on_root_run_id, scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_automation_key ON pipeline_runs(automation_key);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_logs_run ON pipeline_run_logs(run_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_pipeline_run_llm_calls_run ON pipeline_run_llm_calls(run_id, started_at);

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
  dbFilePath = dbPath

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

  // === 迁移：为无重复数据的旧库补上 project_path 唯一索引 ===
  const duplicateProjectPaths = db.prepare(`
    SELECT project_path
    FROM projects
    GROUP BY project_path
    HAVING COUNT(*) > 1
  `).all() as Array<{ project_path: string }>
  if (duplicateProjectPaths.length === 0) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path_unique ON projects(project_path)')
  } else {
    console.warn('[DB] 检测到重复 project_path，跳过唯一索引迁移:', duplicateProjectPaths.map((row) => row.project_path))
  }

  // === 迁移：pipeline_runs 增加队列与详情字段 ===
  const runCols = db.prepare("PRAGMA table_info('pipeline_runs')").all() as { name: string }[]
  const runColNames = new Set(runCols.map(c => c.name))
  const runMigrations: [string, string][] = [
    ['project_path', "ALTER TABLE pipeline_runs ADD COLUMN project_path TEXT DEFAULT ''"],
    ['queued_at', "ALTER TABLE pipeline_runs ADD COLUMN queued_at DATETIME DEFAULT CURRENT_TIMESTAMP"],
    ['queue_position', 'ALTER TABLE pipeline_runs ADD COLUMN queue_position INTEGER'],
    ['error_message', 'ALTER TABLE pipeline_runs ADD COLUMN error_message TEXT'],
    ['payload_json', 'ALTER TABLE pipeline_runs ADD COLUMN payload_json TEXT'],
    ['batch_id', 'ALTER TABLE pipeline_runs ADD COLUMN batch_id TEXT'],
    ['batch_label', 'ALTER TABLE pipeline_runs ADD COLUMN batch_label TEXT'],
    ['priority', "ALTER TABLE pipeline_runs ADD COLUMN priority TEXT DEFAULT 'normal'"],
    ['max_auto_retries', 'ALTER TABLE pipeline_runs ADD COLUMN max_auto_retries INTEGER DEFAULT 0'],
    ['attempt', 'ALTER TABLE pipeline_runs ADD COLUMN attempt INTEGER DEFAULT 0'],
    ['root_run_id', 'ALTER TABLE pipeline_runs ADD COLUMN root_run_id TEXT'],
    ['worker_slot', 'ALTER TABLE pipeline_runs ADD COLUMN worker_slot INTEGER'],
    ['archived_at', 'ALTER TABLE pipeline_runs ADD COLUMN archived_at DATETIME'],
    ['depends_on_root_run_id', 'ALTER TABLE pipeline_runs ADD COLUMN depends_on_root_run_id TEXT'],
    ['trigger_condition', "ALTER TABLE pipeline_runs ADD COLUMN trigger_condition TEXT DEFAULT 'always'"],
    ['scheduled_at', 'ALTER TABLE pipeline_runs ADD COLUMN scheduled_at DATETIME'],
    ['template_id', 'ALTER TABLE pipeline_runs ADD COLUMN template_id TEXT'],
    ['template_label', 'ALTER TABLE pipeline_runs ADD COLUMN template_label TEXT'],
    ['schedule_id', 'ALTER TABLE pipeline_runs ADD COLUMN schedule_id TEXT'],
    ['schedule_label', 'ALTER TABLE pipeline_runs ADD COLUMN schedule_label TEXT'],
    ['automation_key', 'ALTER TABLE pipeline_runs ADD COLUMN automation_key TEXT'],
    ['dead_lettered_at', 'ALTER TABLE pipeline_runs ADD COLUMN dead_lettered_at DATETIME'],
    ['recovery_note', 'ALTER TABLE pipeline_runs ADD COLUMN recovery_note TEXT'],
    ['llm_call_count', 'ALTER TABLE pipeline_runs ADD COLUMN llm_call_count INTEGER DEFAULT 0'],
    ['llm_success_count', 'ALTER TABLE pipeline_runs ADD COLUMN llm_success_count INTEGER DEFAULT 0'],
    ['llm_failure_count', 'ALTER TABLE pipeline_runs ADD COLUMN llm_failure_count INTEGER DEFAULT 0'],
    ['llm_input_tokens', 'ALTER TABLE pipeline_runs ADD COLUMN llm_input_tokens INTEGER DEFAULT 0'],
    ['llm_output_tokens', 'ALTER TABLE pipeline_runs ADD COLUMN llm_output_tokens INTEGER DEFAULT 0'],
    ['llm_total_tokens', 'ALTER TABLE pipeline_runs ADD COLUMN llm_total_tokens INTEGER DEFAULT 0'],
    ['llm_estimated_cost_usd', 'ALTER TABLE pipeline_runs ADD COLUMN llm_estimated_cost_usd REAL DEFAULT 0'],
    ['llm_total_duration_ms', 'ALTER TABLE pipeline_runs ADD COLUMN llm_total_duration_ms INTEGER DEFAULT 0'],
    ['llm_last_provider', 'ALTER TABLE pipeline_runs ADD COLUMN llm_last_provider TEXT'],
    ['llm_last_model', 'ALTER TABLE pipeline_runs ADD COLUMN llm_last_model TEXT'],
    ['llm_last_failure_class', 'ALTER TABLE pipeline_runs ADD COLUMN llm_last_failure_class TEXT'],
    ['llm_last_called_at', 'ALTER TABLE pipeline_runs ADD COLUMN llm_last_called_at DATETIME']
  ]
  for (const [col, sql] of runMigrations) {
    if (!runColNames.has(col)) db.exec(sql)
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status, priority, queue_position, queued_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_strategy_status ON pipeline_runs(status, priority, queue_position, queued_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_archived ON pipeline_runs(archived_at, last_updated_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_orchestration ON pipeline_runs(depends_on_root_run_id, scheduled_at, status)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_runs_automation_key ON pipeline_runs(automation_key)')
  db.exec('CREATE TABLE IF NOT EXISTS pipeline_run_logs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id), stage TEXT NOT NULL, level TEXT NOT NULL, event_type TEXT NOT NULL, message TEXT NOT NULL, timestamp DATETIME NOT NULL)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_run_logs_run ON pipeline_run_logs(run_id, timestamp)')
  db.exec('CREATE TABLE IF NOT EXISTS pipeline_run_llm_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES pipeline_runs(run_id), stage TEXT NOT NULL, phase TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, stream BOOLEAN DEFAULT 0, started_at DATETIME NOT NULL, ended_at DATETIME, duration_ms INTEGER DEFAULT 0, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER, token_source TEXT, estimated_cost_usd REAL, failure_class TEXT, error_message TEXT)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pipeline_run_llm_calls_run ON pipeline_run_llm_calls(run_id, started_at)')

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

export function getDatabaseFilePath(): string {
  if (dbFilePath) return dbFilePath
  const userDataPath = app.getPath('userData')
  return join(userDataPath, 'data', 'feicai.db')
}
