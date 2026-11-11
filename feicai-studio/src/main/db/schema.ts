// Table creation must precede legacy column migrations; indexes run last.
export const TABLES = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visual_style TEXT,
  target_medium TEXT,
  project_path TEXT NOT NULL,
  total_episodes INTEGER DEFAULT 0,
  config_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  episode_number INTEGER NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'idle',
  story_beat_path TEXT,
  story_review_path TEXT,
  script_path TEXT,
  script_review_path TEXT,
  director_analysis_path TEXT,
  character_design_path TEXT,
  art_design_path TEXT,
  storyboard_path TEXT,
  seedance_prompts_path TEXT,
  storyboard_review_path TEXT,
  has_story_beat BOOLEAN DEFAULT 0,
  has_story_review BOOLEAN DEFAULT 0,
  has_script BOOLEAN DEFAULT 0,
  has_script_review BOOLEAN DEFAULT 0,
  has_director BOOLEAN DEFAULT 0,
  has_character BOOLEAN DEFAULT 0,
  has_art BOOLEAN DEFAULT 0,
  has_storyboard BOOLEAN DEFAULT 0,
  has_prompts BOOLEAN DEFAULT 0,
  has_storyboard_review BOOLEAN DEFAULT 0,
  total_duration_seconds REAL,
  total_prompts INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, episode_number)
);

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

CREATE TABLE IF NOT EXISTS asset_references (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  prompt_index INTEGER NOT NULL,
  asset_type TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  reference_tag TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS llm_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'llm',
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  wire_api TEXT DEFAULT 'chat-completions',
  reasoning_effort TEXT DEFAULT 'medium',
  image_size TEXT DEFAULT '1024x1024',
  image_quality TEXT DEFAULT 'auto',
  image_output_format TEXT DEFAULT 'png',
  image_background TEXT DEFAULT 'auto',
  max_tokens INTEGER DEFAULT 8192,
  temperature REAL DEFAULT 0.7,
  is_default BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id),
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  details_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

export const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_episodes_project ON episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_episode ON reviews(episode_id);
CREATE INDEX IF NOT EXISTS idx_reviews_episode_created ON reviews(episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_episode ON execution_logs(episode_id);
CREATE INDEX IF NOT EXISTS idx_refs_episode ON asset_references(episode_id);
CREATE INDEX IF NOT EXISTS idx_llm_configs_category_default_name ON llm_configs(category, is_default DESC, name);
`
