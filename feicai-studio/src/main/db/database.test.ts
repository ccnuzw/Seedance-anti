import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDatabase, initDatabase } from './database'
import { DATABASE_VERSION, migrateDatabase } from './migrations'
import { TABLES } from './schema'

const runtime = vi.hoisted(() => ({
  directory: '',
  connections: [] as { isOpen: boolean }[]
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData' || !runtime.directory) {
        throw new Error('Tests must only access temporary userData')
      }
      return runtime.directory
    }
  }
}))

// Under Electron, exercise the installed native driver directly. Under Node,
// its ABI differs, so adapt the connection API to node:sqlite instead. Both
// paths execute every statement/transaction on real, file-backed SQLite.
vi.mock('better-sqlite3', async (importOriginal) => {
  if (process.versions.electron) {
    const { default: NativeDatabase } = await importOriginal<{
      default: typeof import('better-sqlite3')
    }>()
    return {
      default: class extends NativeDatabase {
        constructor(path: string) {
          super(path)
          runtime.connections.push(this)
        }

        get isOpen() {
          return this.open
        }
      }
    }
  }
  const { DatabaseSync } = await import('node:sqlite')
  return {
    default: class extends DatabaseSync {
      constructor(path: string) {
        super(path)
        runtime.connections.push(this)
      }

      pragma(sql: string) {
        return this.prepare(`PRAGMA ${sql}`).all()
      }
    }
  }
})

// Independent historical fixture: all fields previously added by ALTER TABLE
// are absent, including category (the original startup failure).
const LEGACY_SCHEMA = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, visual_style TEXT,
  target_medium TEXT, project_path TEXT NOT NULL,
  total_episodes INTEGER DEFAULT 0, config_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE episodes (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  episode_number INTEGER NOT NULL, title TEXT, status TEXT DEFAULT 'idle',
  script_path TEXT, director_analysis_path TEXT, seedance_prompts_path TEXT,
  total_duration_seconds REAL, total_prompts INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, episode_number)
);
CREATE TABLE llm_configs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
  base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, model TEXT NOT NULL,
  max_tokens INTEGER DEFAULT 8192, temperature REAL DEFAULT 0.7,
  is_default BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO projects (id, name, project_path, config_json)
  VALUES ('project-1', '历史项目', '/fixture/project', '{"keep":true}');
INSERT INTO episodes (id, project_id, episode_number, title, script_path, status)
  VALUES ('episode-1', 'project-1', 1, '历史集数', 'script.md', 'completed');
INSERT INTO llm_configs
  (id, name, provider, base_url, api_key_encrypted, model, is_default)
  VALUES ('config-1', '历史配置', 'openai', 'https://fixture.invalid',
    'fixture-ciphertext-not-a-key', 'fixture-model', 1);
`

let path: string

function withConnection<T>(action: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path)
  try {
    return action(database)
  } finally {
    database.close()
  }
}

function createLegacyDatabase(): void {
  withConnection((database) => database.exec(LEGACY_SCHEMA))
}

function schemaSnapshot(database: DatabaseSync) {
  return database
    .prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
    .all()
}

function legacyRows(database: DatabaseSync) {
  return ['projects', 'episodes', 'llm_configs'].map((table) => ({
    table,
    rows: database.prepare(`SELECT * FROM ${table}`).all()
  }))
}

function expectCurrentSchema(database: ReturnType<typeof initDatabase>): void {
  expect(database.prepare('PRAGMA user_version').get()).toEqual({
    user_version: DATABASE_VERSION
  })
  expect(
    database
      .prepare("PRAGMA index_info('idx_llm_configs_category_default_name')")
      .all()
  ).toEqual([
    expect.objectContaining({ name: 'category' }),
    expect.objectContaining({ name: 'is_default' }),
    expect.objectContaining({ name: 'name' })
  ])
  expect(database.prepare('PRAGMA integrity_check').get()).toEqual({
    integrity_check: 'ok'
  })
  expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
}

beforeEach(() => {
  runtime.directory = mkdtempSync(join(tmpdir(), 'feicai-database-test-'))
  mkdirSync(join(runtime.directory, 'data'))
  path = join(runtime.directory, 'data', 'feicai.db')
  runtime.connections = []
})

afterEach(() => {
  closeDatabase()
  rmSync(runtime.directory, { recursive: true, force: true })
  runtime.directory = ''
})

describe('SQLite initialization and migrations', () => {
  it('creates a fresh database with indexes, defaults and enforced constraints', () => {
    expect(() => getDatabase()).toThrow('数据库未初始化')
    const database = initDatabase()
    expect(getDatabase()).toBe(database)
    expectCurrentSchema(database)
    expect(database.pragma('journal_mode')).toEqual([{ journal_mode: 'wal' }])
    expect(database.pragma('foreign_keys')).toEqual([{ foreign_keys: 1 }])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
    ).toHaveLength(8)
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"
        )
        .all()
    ).toHaveLength(9)
    expect(() =>
      database.exec(
        "INSERT INTO episodes (id, project_id, episode_number) VALUES ('e', 'missing', 1)"
      )
    ).toThrow(/FOREIGN KEY/)
    database.exec(
      "INSERT INTO projects (id, name, project_path) VALUES ('p', 'test', '/fixture')"
    )
    database.exec(
      "INSERT INTO episodes (id, project_id, episode_number) VALUES ('e', 'p', 1)"
    )
    expect(() =>
      database.exec(
        "INSERT INTO episodes (id, project_id, episode_number) VALUES ('e2', 'p', 1)"
      )
    ).toThrow(/UNIQUE/)
    expect(
      database
        .prepare("SELECT status, has_story_beat FROM episodes WHERE id = 'e'")
        .get()
    ).toEqual({
      status: 'idle',
      has_story_beat: 0
    })
  })

  it('upgrades an unversioned legacy database before creating dependent indexes and preserves every old value', () => {
    createLegacyDatabase()
    const before = withConnection(legacyRows)
    const database = initDatabase()
    expectCurrentSchema(database)
    for (const { table, rows } of before) {
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(
        rows.map((row) => expect.objectContaining(row))
      )
    }
    expect(database.prepare('SELECT * FROM llm_configs').get()).toMatchObject({
      category: 'llm',
      wire_api: 'chat-completions',
      reasoning_effort: 'medium',
      image_size: '1024x1024',
      image_quality: 'auto',
      image_output_format: 'png',
      image_background: 'auto'
    })
    expect(database.prepare('SELECT * FROM episodes').get()).toMatchObject({
      story_beat_path: null,
      story_review_path: null,
      script_review_path: null,
      art_design_path: null,
      character_design_path: null,
      storyboard_path: null,
      storyboard_review_path: null,
      has_story_beat: 0,
      has_story_review: 0,
      has_script: 0,
      has_script_review: 0,
      has_director: 0,
      has_character: 0,
      has_art: 0,
      has_storyboard: 0,
      has_prompts: 0,
      has_storyboard_review: 0
    })
    const fresh = new DatabaseSync(':memory:')
    try {
      migrateDatabase(fresh)
      for (const table of ['episodes', 'llm_configs']) {
        const normalize = (rows: unknown[]) =>
          (rows as { name: string; cid: number }[])
            .map(({ cid: _cid, ...column }) => column)
            .sort((left, right) => left.name.localeCompare(right.name))
        expect(
          normalize(database.prepare(`PRAGMA table_info('${table}')`).all())
        ).toEqual(
          normalize(fresh.prepare(`PRAGMA table_info('${table}')`).all())
        )
      }
    } finally {
      fresh.close()
    }
  })

  it('handles partially upgraded unversioned databases without overwriting existing new fields', () => {
    createLegacyDatabase()
    withConnection((database) =>
      database.exec(`
      ALTER TABLE llm_configs ADD COLUMN category TEXT DEFAULT 'llm';
      ALTER TABLE llm_configs ADD COLUMN image_quality TEXT DEFAULT 'auto';
      ALTER TABLE episodes ADD COLUMN has_script BOOLEAN DEFAULT 0;
      ALTER TABLE episodes ADD COLUMN story_beat_path TEXT;
      UPDATE llm_configs SET category = 'image', image_quality = 'high';
      UPDATE episodes SET has_script = 1, story_beat_path = 'story.md';
    `)
    )
    const database = initDatabase()
    expectCurrentSchema(database)
    expect(database.prepare('SELECT * FROM llm_configs').get()).toMatchObject({
      category: 'image',
      image_quality: 'high',
      wire_api: 'chat-completions'
    })
    expect(database.prepare('SELECT * FROM episodes').get()).toMatchObject({
      has_script: 1,
      story_beat_path: 'story.md',
      has_art: 0
    })
  })

  it('adopts an existing current schema without a version and preserves related data', () => {
    withConnection((database) => {
      database.exec(TABLES)
      database.exec(`
        INSERT INTO projects (id, name, project_path) VALUES ('p', 'test', '/fixture');
        INSERT INTO episodes (id, project_id, episode_number) VALUES ('e', 'p', 1);
        INSERT INTO characters (id, project_id, name) VALUES ('c', 'p', '角色');
        INSERT INTO scenes (id, project_id, name) VALUES ('s', 'p', '场景');
        INSERT INTO asset_references (id, episode_id, prompt_index, asset_type, asset_id, reference_tag)
          VALUES ('a', 'e', 1, 'character', 'c', '@角色');
        INSERT INTO reviews (id, episode_id, stage, review_type, result, feedback)
          VALUES ('r', 'e', 'script', 'auto', 'pass', '保留');
        INSERT INTO execution_logs (id, episode_id, stage, event_type, message)
          VALUES ('l', 'e', 'script', 'complete', '保留');
      `)
    })
    const before = withConnection((database) =>
      [
        'projects',
        'episodes',
        'characters',
        'scenes',
        'asset_references',
        'reviews',
        'execution_logs'
      ].map((table) => ({
        table,
        rows: database.prepare(`SELECT * FROM ${table}`).all()
      }))
    )
    const database = initDatabase()
    expectCurrentSchema(database)
    for (const { table, rows } of before) {
      expect(database.prepare(`SELECT * FROM ${table}`).all()).toEqual(rows)
    }
  })

  it('is idempotent for repeated initialization, migration and reopening', () => {
    createLegacyDatabase()
    const first = initDatabase()
    expect(initDatabase()).toBe(first)
    expect(runtime.connections).toHaveLength(1)
    const before = withConnection((database) => ({
      schema: schemaSnapshot(database),
      rows: legacyRows(database)
    }))
    for (let attempt = 0; attempt < 3; attempt++) {
      closeDatabase()
      expect(() => getDatabase()).toThrow('数据库未初始化')
      const reopened = initDatabase()
      migrateDatabase(reopened)
      expectCurrentSchema(reopened)
      expect(
        withConnection((database) => ({
          schema: schemaSnapshot(database),
          rows: legacyRows(database)
        }))
      ).toEqual(before)
    }
    expect(
      runtime.connections.slice(0, -1).every((connection) => !connection.isOpen)
    ).toBe(true)
  })

  it('rolls back all DDL and version changes, closes the failed connection and allows retry after repair', () => {
    createLegacyDatabase()
    // A table occupying the final index name makes SQLite fail only after
    // creating other tables, adding legacy columns and creating earlier indexes.
    withConnection((database) =>
      database.exec(
        'CREATE TABLE idx_llm_configs_category_default_name (fixture TEXT)'
      )
    )
    const before = withConnection((database) => ({
      schema: schemaSnapshot(database),
      rows: legacyRows(database)
    }))
    expect(() => initDatabase()).toThrow(/already a table/)
    expect(() => getDatabase()).toThrow('数据库未初始化')
    expect(runtime.connections).toHaveLength(1)
    expect(runtime.connections[0].isOpen).toBe(false)
    withConnection((database) => {
      expect(schemaSnapshot(database)).toEqual(before.schema)
      expect(legacyRows(database)).toEqual(before.rows)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({
        user_version: 0
      })
      database.exec('DROP TABLE idx_llm_configs_category_default_name')
    })
    const recovered = initDatabase()
    expectCurrentSchema(recovered)
    expect(runtime.connections).toHaveLength(2)
    for (const { table, rows } of before.rows) {
      expect(recovered.prepare(`SELECT * FROM ${table}`).all()).toEqual(
        rows.map((row) => expect.objectContaining(row))
      )
    }
  })

  it('rejects a newer database version without changing its schema or caching a connection', () => {
    createLegacyDatabase()
    withConnection((database) =>
      database.exec(`PRAGMA user_version = ${DATABASE_VERSION + 1}`)
    )
    const before = withConnection(schemaSnapshot)
    expect(() => initDatabase()).toThrow('高于当前支持的版本')
    expect(() => getDatabase()).toThrow('数据库未初始化')
    expect(runtime.connections[0].isOpen).toBe(false)
    withConnection((database) => {
      expect(schemaSnapshot(database)).toEqual(before)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({
        user_version: DATABASE_VERSION + 1
      })
    })
  })
})
