import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  userDataPath: ''
}))

const require = createRequire(import.meta.url)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unsupported electron app path: ${name}`)
      }
      return electronState.userDataPath
    },
    isPackaged: false
  }
}))

function hasNativeBetterSqliteBinding(): boolean {
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const probeDir = mkdtempSync(join(tmpdir(), 'feicai-sqlite-probe-'))
    const probePath = join(probeDir, 'probe.db')
    const db = new Database(probePath)
    db.close()
    tempDirs.push(probeDir)
    return true
  } catch {
    return false
  }
}

const tempDirs: string[] = []
const nativeBetterSqliteReady = hasNativeBetterSqliteBinding()

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  if (nativeBetterSqliteReady) {
    const { closeDatabase } = await import('./database')
    closeDatabase()
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('queries.deleteProject', () => {
  const integrationTest = nativeBetterSqliteReady ? it : it.skip

  integrationTest('removes project rows together with pipeline and adapt dependencies', async () => {
    const [{ initDatabase, getDatabase }, queries] = await Promise.all([
      import('./database'),
      import('./queries')
    ])

    electronState.userDataPath = makeTempDir('feicai-queries-userdata-')
    initDatabase()

    const projectPath = makeTempDir('feicai-queries-project-')
    const project = queries.createProject({
      name: '删除回归项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath,
      totalEpisodes: 1,
      config: {}
    })

    const episode = queries.listEpisodes(project.id)[0]
    expect(episode).toBeDefined()

    const db = getDatabase()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO reviews (id, episode_id, stage, review_type, score, result, feedback, issues_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('review-1', episode.id, 'script', 'qa', 95, 'pass', 'ok', '[]', now)

    db.prepare(`
      INSERT INTO asset_references (id, episode_id, prompt_index, asset_type, asset_id, reference_tag)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('asset-ref-1', episode.id, 1, 'character', 'character-1', 'tag-1')

    db.prepare(`
      INSERT INTO execution_logs (id, episode_id, stage, event_type, message, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('log-1', episode.id, 'script', 'started', 'running', '{}', now)

    db.prepare(`
      INSERT INTO pipeline_runs (
        run_id, project_id, project_path, episode_number, current_stage, status, state,
        single_stage, queued_at, last_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-1', project.id, project.projectPath, episode.episodeNumber, 'script', 'queued', '{}', 0, now, now)

    db.prepare(`
      INSERT INTO pipeline_run_logs (id, run_id, stage, level, event_type, message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('run-log-1', 'run-1', 'script', 'info', 'queued', 'queued', now)

    db.prepare(`
      INSERT INTO pipeline_run_llm_calls (
        id, run_id, stage, phase, provider, model, status, stream, started_at, ended_at, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('run-llm-1', 'run-1', 'script', 'generation', 'openai', 'gpt-test', 'success', 0, now, now, 120)

    db.prepare(`
      INSERT INTO novels (id, project_id, title, genre, total_chapters, chapters_dir, processed_chapters, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('novel-1', project.id, '测试小说', '都市', 10, join(project.projectPath, 'novel'), 2, now)

    db.prepare(`
      INSERT INTO adapt_batches (id, project_id, batch_number, chapter_start, chapter_end, plot_count, status, review_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('batch-1', project.id, 1, 1, 10, 1, 'pending', 88, now)

    db.prepare(`
      INSERT INTO plot_points (id, project_id, batch_id, plot_number, scene, description, hook_type, episode_number, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('plot-1', project.id, 'batch-1', 1, 'scene', 'description', 'hook', 1, 'unused', now)

    queries.deleteProject(project.id)

    expect(db.prepare('SELECT COUNT(*) AS count FROM projects WHERE id = ?').get(project.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM episodes WHERE project_id = ?').get(project.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM reviews').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_references').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM execution_logs').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM pipeline_runs WHERE project_id = ?').get(project.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM pipeline_run_logs').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM pipeline_run_llm_calls').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM novels WHERE project_id = ?').get(project.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM adapt_batches WHERE project_id = ?').get(project.id)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM plot_points WHERE project_id = ?').get(project.id)).toEqual({ count: 0 })
  })

  integrationTest('syncEpisodeStatus refreshes EP01 from script idle to director after director analysis lands', async () => {
    const [{ initDatabase }, queries] = await Promise.all([
      import('./database'),
      import('./queries')
    ])

    electronState.userDataPath = makeTempDir('feicai-queries-userdata-')
    initDatabase()

    const projectPath = makeTempDir('feicai-queries-project-')
    const project = queries.createProject({
      name: '导演阶段回归项目',
      sourceType: 'script',
      phase: 'production',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath,
      totalEpisodes: 1,
      config: {}
    })

    const { mkdirSync, writeFileSync } = await import('fs')
    const scriptDir = join(projectPath, 'script')
    const outputDir = join(projectPath, 'outputs', 'ep001')
    mkdirSync(scriptDir, { recursive: true })
    writeFileSync(join(scriptDir, 'ep001.md'), '# EP001 剧本', 'utf-8')

    let episodes = queries.syncEpisodeStatus(project.id, projectPath)
    expect(episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'idle',
      hasScript: true,
      hasDirectorAnalysis: false
    })

    mkdirSync(outputDir, { recursive: true })
    writeFileSync(join(outputDir, '01-director-analysis.md'), '# 导演分析', 'utf-8')

    episodes = queries.syncEpisodeStatus(project.id, projectPath)
    expect(episodes[0]).toMatchObject({
      episodeNumber: 1,
      status: 'director',
      hasScript: true,
      hasDirectorAnalysis: true,
      directorAnalysisPath: join(projectPath, 'outputs', 'ep001', '01-director-analysis.md')
    })
  })
})
