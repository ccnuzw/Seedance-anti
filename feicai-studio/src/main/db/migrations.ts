import { INDEXES, TABLES } from './schema'

// Shared by better-sqlite3 and the real SQLite engine used in regression tests.
interface MigrationDatabase {
  exec(sql: string): unknown
  prepare(sql: string): { all(): unknown[]; get(): unknown }
}

const LEGACY_COLUMNS = {
  episodes: {
    story_beat_path: 'TEXT',
    story_review_path: 'TEXT',
    script_review_path: 'TEXT',
    art_design_path: 'TEXT',
    character_design_path: 'TEXT',
    storyboard_path: 'TEXT',
    storyboard_review_path: 'TEXT',
    has_story_beat: 'BOOLEAN DEFAULT 0',
    has_story_review: 'BOOLEAN DEFAULT 0',
    has_script: 'BOOLEAN DEFAULT 0',
    has_script_review: 'BOOLEAN DEFAULT 0',
    has_director: 'BOOLEAN DEFAULT 0',
    has_character: 'BOOLEAN DEFAULT 0',
    has_art: 'BOOLEAN DEFAULT 0',
    has_storyboard: 'BOOLEAN DEFAULT 0',
    has_prompts: 'BOOLEAN DEFAULT 0',
    has_storyboard_review: 'BOOLEAN DEFAULT 0'
  },
  llm_configs: {
    category: "TEXT DEFAULT 'llm'",
    wire_api: "TEXT DEFAULT 'chat-completions'",
    reasoning_effort: "TEXT DEFAULT 'medium'",
    image_size: "TEXT DEFAULT '1024x1024'",
    image_quality: "TEXT DEFAULT 'auto'",
    image_output_format: "TEXT DEFAULT 'png'",
    image_background: "TEXT DEFAULT 'auto'"
  }
}

// Append migrations in version order. Version 0 includes both empty databases
// and all historical databases, whose columns may already be partially updated.
const MIGRATIONS: ((database: MigrationDatabase) => void)[] = [
  (database) => {
    database.exec(TABLES)
    for (const [table, definitions] of Object.entries(LEGACY_COLUMNS)) {
      const columns = database
        .prepare(`PRAGMA table_info('${table}')`)
        .all() as {
        name: string
      }[]
      const existing = new Set(columns.map(({ name }) => name))
      for (const [column, definition] of Object.entries(definitions)) {
        if (!existing.has(column)) {
          database.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
          )
        }
      }
    }
    database.exec(INDEXES)
  }
]

export const DATABASE_VERSION = MIGRATIONS.length

/** Atomically upgrade the schema and its version without rewriting user rows. */
export function migrateDatabase(database: MigrationDatabase): void {
  // Read the version under the write lock so concurrent opens cannot race.
  database.exec('BEGIN IMMEDIATE')
  try {
    const { user_version: version } = database
      .prepare('PRAGMA user_version')
      .get() as { user_version: number }
    if (version > DATABASE_VERSION) {
      throw new Error(
        `数据库版本 ${version} 高于当前支持的版本 ${DATABASE_VERSION}`
      )
    }
    for (let index = version; index < MIGRATIONS.length; index++) {
      MIGRATIONS[index](database)
      database.exec(`PRAGMA user_version = ${index + 1}`)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
