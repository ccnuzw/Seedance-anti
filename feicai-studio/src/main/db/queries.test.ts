import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { EpisodeScanResult, ProjectScanResult } from '../project-sync/scan'

type Row = Record<string, unknown>

const tables = {
  projects: [] as Row[],
  episodes: [] as Row[],
  reviews: [] as Row[],
  assetReferences: [] as Row[],
  executionLogs: [] as Row[]
}

function resetTables(): void {
  tables.projects = []
  tables.episodes = []
  tables.reviews = []
  tables.assetReferences = []
  tables.executionLogs = []
}

function createStatement(sql: string) {
  return {
    run: (...args: unknown[]) => {
      if (sql.includes('INSERT INTO projects')) {
        tables.projects.push({
          id: args[0],
          name: args[1],
          visual_style: args[2],
          target_medium: args[3],
          project_path: args[4],
          total_episodes: args[5],
          config_json: args[6],
          created_at: args[7],
          updated_at: args[8]
        })
        return
      }
      if (
        sql.includes('DELETE FROM reviews') &&
        sql.includes(
          'WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)'
        )
      ) {
        const episodeIds = new Set(
          tables.episodes
            .filter((row) => row.project_id === args[0])
            .map((row) => row.id)
        )
        tables.reviews = tables.reviews.filter(
          (row) => !episodeIds.has(row.episode_id)
        )
        return
      }
      if (sql.startsWith('DELETE FROM reviews WHERE episode_id = ?')) {
        tables.reviews = tables.reviews.filter(
          (row) => row.episode_id !== args[0]
        )
        return
      }
      if (
        sql.includes('DELETE FROM asset_references') &&
        sql.includes(
          'WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)'
        )
      ) {
        const episodeIds = new Set(
          tables.episodes
            .filter((row) => row.project_id === args[0])
            .map((row) => row.id)
        )
        tables.assetReferences = tables.assetReferences.filter(
          (row) => !episodeIds.has(row.episode_id)
        )
        return
      }
      if (sql.startsWith('DELETE FROM asset_references WHERE episode_id = ?')) {
        tables.assetReferences = tables.assetReferences.filter(
          (row) => row.episode_id !== args[0]
        )
        return
      }
      if (
        sql.includes('DELETE FROM execution_logs') &&
        sql.includes(
          'WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)'
        )
      ) {
        const episodeIds = new Set(
          tables.episodes
            .filter((row) => row.project_id === args[0])
            .map((row) => row.id)
        )
        tables.executionLogs = tables.executionLogs.filter(
          (row) => !episodeIds.has(row.episode_id)
        )
        return
      }
      if (sql.startsWith('DELETE FROM execution_logs WHERE episode_id = ?')) {
        tables.executionLogs = tables.executionLogs.filter(
          (row) => row.episode_id !== args[0]
        )
        return
      }
      if (sql.startsWith('DELETE FROM episodes WHERE id = ?')) {
        tables.episodes = tables.episodes.filter((row) => row.id !== args[0])
        return
      }
      if (sql.startsWith('DELETE FROM episodes WHERE project_id = ?')) {
        tables.episodes = tables.episodes.filter(
          (row) => row.project_id !== args[0]
        )
        return
      }
      if (
        sql.startsWith('UPDATE projects SET total_episodes = ? WHERE id = ?')
      ) {
        const project = tables.projects.find((row) => row.id === args[1])
        if (project) project.total_episodes = args[0]
        return
      }
      if (
        sql.includes('UPDATE projects') &&
        sql.includes('WHERE project_path = ?')
      ) {
        const project = tables.projects.find(
          (row) => row.project_path === args[6]
        )
        if (project) {
          project.name = args[0]
          project.visual_style = args[1]
          project.target_medium = args[2]
          project.total_episodes = args[3]
          project.config_json = args[4]
          project.updated_at = args[5]
        }
        return
      }
      if (sql.includes('UPDATE projects') && sql.includes('WHERE id = ?')) {
        const project = tables.projects.find((row) => row.id === args[6])
        if (project) {
          project.name = args[0]
          project.visual_style = args[1]
          project.target_medium = args[2]
          project.total_episodes = args[3]
          project.config_json = args[4]
          project.updated_at = args[5]
        }
        return
      }
      if (sql.includes('INSERT OR IGNORE INTO episodes')) {
        const projectId = args[1]
        const episodeNumber = args[2]
        const exists = tables.episodes.some(
          (row) =>
            row.project_id === projectId && row.episode_number === episodeNumber
        )
        if (!exists) {
          tables.episodes.push({
            id: args[0],
            project_id: projectId,
            episode_number: episodeNumber,
            title: args[3],
            status: args[4],
            story_beat_path: args[5],
            script_path: args[6],
            script_review_path: args[7],
            director_analysis_path: args[8],
            character_design_path: args[9],
            art_design_path: args[10],
            storyboard_path: args[11],
            seedance_prompts_path: args[12],
            storyboard_review_path: args[13],
            has_story_beat: args[14],
            has_script: args[15],
            has_script_review: args[16],
            has_director: args[17],
            has_character: args[18],
            has_art: args[19],
            has_storyboard: args[20],
            has_prompts: args[21],
            has_storyboard_review: args[22],
            total_prompts: args[23],
            total_duration_seconds: args[24],
            created_at: args[25],
            updated_at: args[26]
          })
        }
        return
      }
      throw new Error(`Unhandled run SQL: ${sql}`)
    },
    get: (...args: unknown[]) => {
      if (sql.includes('FROM projects WHERE id = ?')) {
        return tables.projects.find((row) => row.id === args[0])
      }
      if (sql.includes('SELECT total_episodes FROM projects WHERE id = ?')) {
        return tables.projects.find((row) => row.id === args[0])
      }
      return undefined
    },
    all: (...args: unknown[]) => {
      if (sql.includes('FROM projects ORDER BY updated_at DESC')) {
        return [...tables.projects]
      }
      if (
        sql.startsWith(
          'SELECT id, episode_number FROM episodes WHERE project_id = ?'
        )
      ) {
        return tables.episodes
          .filter((row) => row.project_id === args[0])
          .map((row) => ({ id: row.id, episode_number: row.episode_number }))
      }
      if (
        sql.includes(
          'FROM episodes WHERE project_id = ? ORDER BY episode_number'
        )
      ) {
        return tables.episodes
          .filter((row) => row.project_id === args[0])
          .sort((a, b) => Number(a.episode_number) - Number(b.episode_number))
      }
      return []
    }
  }
}

const mockDb = {
  prepare: vi.fn((sql: string) => createStatement(sql)),
  transaction: vi.fn(
    (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        fn(...args)
  )
}

vi.mock('../workers/project-sync-worker?modulePath', () => ({
  default: 'mock-project-sync-worker'
}))

vi.mock('./database', () => ({
  getDatabase: () => mockDb
}))

const mockEpisodeSnapshot: EpisodeScanResult = {
  episodeNumber: 1,
  title: '第1集',
  status: 'script',
  storyBeatPath: null,
  scriptPath: '/tmp/project/script/ep01.md',
  scriptReviewPath: null,
  directorAnalysisPath: null,
  characterDesignPath: null,
  artDesignPath: null,
  storyboardPath: null,
  seedancePromptsPath: null,
  storyboardReviewPath: null,
  hasStoryBeat: false,
  hasScript: true,
  hasScriptReview: false,
  hasDirectorAnalysis: false,
  hasCharacterDesign: false,
  hasArtDesign: false,
  hasStoryboard: false,
  hasSeedancePrompts: false,
  hasStoryboardReview: false,
  totalPrompts: null,
  totalDurationSeconds: null
}

const mockProjectScanResult: ProjectScanResult = {
  hasSourceNovel: false,
  episodeNumbers: [1],
  episodes: [mockEpisodeSnapshot]
}

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('events')

  class MockWorker extends EventEmitter {
    constructor(_path: string, options: { workerData: { mode: string } }) {
      super()
      queueMicrotask(() => {
        const payload =
          options.workerData.mode === 'project'
            ? mockProjectScanResult
            : { episode: mockProjectScanResult.episodes[0] }
        this.emit('message', payload)
      })
    }
  }

  return { Worker: MockWorker }
})

describe('queries syncEpisodesFromFilesystem', async () => {
  const queries = await import('./queries')
  const tempDirs: string[] = []

  beforeEach(() => {
    resetTables()
    const now = new Date().toISOString()
    tables.projects.push({
      id: 'project-1',
      name: '测试项目',
      visual_style: '现实',
      target_medium: '短剧',
      project_path: '/tmp/project',
      total_episodes: 2,
      config_json: JSON.stringify({
        projectName: '测试项目',
        totalEpisodes: 2
      }),
      created_at: now,
      updated_at: now
    })
    tables.episodes.push({
      id: 'episode-1',
      project_id: 'project-1',
      episode_number: 1,
      title: '第1集',
      status: 'script',
      script_path: '/tmp/project/script/ep01.md',
      has_script: 1,
      created_at: now,
      updated_at: now
    })
    tables.episodes.push({
      id: 'episode-2',
      project_id: 'project-1',
      episode_number: 2,
      title: '第2集',
      status: 'script',
      script_path: '/tmp/project/script/ep02.md',
      has_script: 1,
      created_at: now,
      updated_at: now
    })
    tables.reviews.push({ id: 'review-2', episode_id: 'episode-2' })
    tables.assetReferences.push({ id: 'asset-ref-2', episode_id: 'episode-2' })
    tables.executionLogs.push({ id: 'log-2', episode_id: 'episode-2' })
  })

  afterEach(() => {
    vi.clearAllMocks()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('会清理磁盘扫描结果中已不存在的 episode 及其关联记录', async () => {
    await queries.syncEpisodesFromFilesystem('project-1', '/tmp/project', 2)

    expect(tables.episodes.map((row) => row.episode_number)).toEqual([1])
    expect(tables.reviews).toHaveLength(0)
    expect(tables.assetReferences).toHaveLength(0)
    expect(tables.executionLogs).toHaveLength(0)
  })

  it('导入已有项目时会合并前端推断配置并写回 project-config.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-create-project-'))
    tempDirs.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'ep01.md'), '# 第1集', 'utf-8')
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '旧项目',
          totalEpisodes: 30,
          visualStyle: '电影感',
          targetMedium: '短剧'
        },
        null,
        2
      ),
      'utf-8'
    )

    const project = await queries.createProject({
      name: '旧项目',
      visualStyle: '电影感',
      targetMedium: '短剧',
      projectPath: root,
      totalEpisodes: 30,
      config: {
        projectName: '旧项目',
        totalEpisodes: 30,
        visualStyle: '电影感',
        targetMedium: '短剧',
        entryStage: 'script',
        workflowMode: 'script_to_shortdrama',
        directories: {
          scriptDir: 'scripts'
        }
      }
    })

    expect(project.config.entryStage).toBe('script')
    expect(project.config.workflowMode).toBe('script_to_shortdrama')
    expect(project.config.directories?.scriptDir).toBe('scripts')
    expect(existsSync(join(root, 'scripts'))).toBe(true)

    const writtenConfig = JSON.parse(
      readFileSync(join(root, 'project-config.json'), 'utf-8')
    ) as {
      entryStage?: string
      workflowMode?: string
      directories?: { scriptDir?: string }
    }
    expect(writtenConfig.entryStage).toBe('script')
    expect(writtenConfig.workflowMode).toBe('script_to_shortdrama')
    expect(writtenConfig.directories?.scriptDir).toBe('scripts')
  })

  it('新建非剧本起步项目时会自动生成标准小说原文模板', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-bootstrap-'))
    tempDirs.push(root)

    const project = await queries.createProject({
      name: '新项目',
      visualStyle: '电影感',
      targetMedium: '短剧',
      projectPath: root,
      totalEpisodes: 12,
      config: {
        projectName: '新项目',
        totalEpisodes: 12,
        visualStyle: '电影感',
        targetMedium: '短剧',
        entryStage: 'novel',
        workflowMode: 'novel_to_shortdrama'
      }
    })

    const sourcePath = join(root, 'source', 'novel.md')
    expect(existsSync(sourcePath)).toBe(true)
    expect(readFileSync(sourcePath, 'utf-8')).toContain('> 项目：新项目')
    expect(project.config.entryStage).toBe('novel')
  })

  it('新建小说起步项目时可以导入整本小说并拆分章节', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-import-novel-'))
    const sourceNovel = join(tmpdir(), `feicai-source-${Date.now()}.txt`)
    tempDirs.push(root)
    writeFileSync(
      sourceNovel,
      [
        '第1章 穿成恶女',
        '第1章 穿成恶女陆青青醒了。',
        '',
        '第2章 救人',
        '第2章 救人为母则刚。'
      ].join('\n'),
      'utf-8'
    )

    await queries.createProject({
      name: '导入小说项目',
      visualStyle: '电影感',
      targetMedium: '短剧',
      projectPath: root,
      totalEpisodes: 12,
      sourceNovelFilePath: sourceNovel,
      config: {
        projectName: '导入小说项目',
        totalEpisodes: 12,
        visualStyle: '电影感',
        targetMedium: '短剧',
        entryStage: 'novel',
        workflowMode: 'novel_to_shortdrama'
      }
    })

    const normalizedNovel = readFileSync(
      join(root, 'source', 'novel.md'),
      'utf-8'
    )
    expect(normalizedNovel).toContain('> 识别章节数：2')
    expect(normalizedNovel).toContain('## 第1章 穿成恶女')
    expect(existsSync(join(root, 'source', 'chapters'))).toBe(true)
    expect(
      existsSync(join(root, 'source', 'chapters', 'chapter-001-第1章-穿成恶女.md'))
    ).toBe(true)

    rmSync(sourceNovel, { force: true })
  })

  it('新建从剧情开始项目时会自动生成首集剧情模板和素材库模板', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-bootstrap-story-'))
    tempDirs.push(root)

    await queries.createProject({
      name: '剧情项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      projectPath: root,
      totalEpisodes: 12,
      config: {
        projectName: '剧情项目',
        totalEpisodes: 12,
        entryStage: 'story',
        workflowMode: 'story_to_shortdrama'
      }
    })

    expect(existsSync(join(root, 'story', 'episode-beats', 'ep01.md'))).toBe(
      true
    )
    expect(existsSync(join(root, 'assets', 'character-prompts.md'))).toBe(true)
    expect(existsSync(join(root, 'assets', 'scene-prompts.md'))).toBe(true)
  })

  it('新建从剧本开始项目时会自动生成首集剧本模板和素材库模板', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-bootstrap-script-'))
    tempDirs.push(root)

    await queries.createProject({
      name: '剧本项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      projectPath: root,
      totalEpisodes: 12,
      config: {
        projectName: '剧本项目',
        totalEpisodes: 12,
        entryStage: 'script',
        workflowMode: 'script_to_shortdrama'
      }
    })

    expect(existsSync(join(root, 'script', 'ep01.md'))).toBe(true)
    expect(existsSync(join(root, 'assets', 'character-prompts.md'))).toBe(true)
    expect(existsSync(join(root, 'assets', 'scene-prompts.md'))).toBe(true)
  })

  it('更新项目设置时会写回 project-config.json 并更新数据库记录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-update-project-'))
    tempDirs.push(root)
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '旧项目',
          totalEpisodes: 2,
          visualStyle: '旧风格',
          targetMedium: '旧媒介',
          pipelineSettings: { maxRetries: 3 }
        },
        null,
        2
      ),
      'utf-8'
    )

    tables.projects[0] = {
      ...tables.projects[0],
      project_path: root,
      name: '旧项目',
      visual_style: '旧风格',
      target_medium: '旧媒介',
      total_episodes: 2,
      config_json: JSON.stringify({
        projectName: '旧项目',
        totalEpisodes: 2,
        visualStyle: '旧风格',
        targetMedium: '旧媒介'
      })
    }

    const project = await queries.updateProject({
      id: 'project-1',
      name: '新项目',
      visualStyle: '赛博写实',
      targetMedium: '竖屏短剧',
      totalEpisodes: 6,
      config: {
        pipelineSettings: {
          maxRetries: 4,
          passScore: 8,
          llmTimeoutSec: 120,
          durationMin: 80,
          durationMax: 130,
          singlePromptMax: 9
        }
      }
    })

    const writtenConfig = JSON.parse(
      readFileSync(join(root, 'project-config.json'), 'utf-8')
    ) as Record<string, unknown>
    expect(writtenConfig).toMatchObject({
      projectName: '新项目',
      totalEpisodes: 6,
      visualStyle: '赛博写实',
      targetMedium: '竖屏短剧'
    })
    expect(project.name).toBe('新项目')
    expect(project.visualStyle).toBe('赛博写实')
    expect(project.targetMedium).toBe('竖屏短剧')
    expect(project.totalEpisodes).toBe(6)
    expect(tables.projects[0].name).toBe('新项目')
    expect(Number(tables.projects[0].total_episodes)).toBe(6)
  })

  it('修复项目配置时会同步更新数据库中的项目记录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'feicai-repair-sync-'))
    tempDirs.push(root)
    writeFileSync(
      join(root, 'project-config.json'),
      JSON.stringify(
        {
          projectName: '磁盘项目',
          totalEpisodes: 8,
          visualStyle: '写实',
          targetMedium: '短剧'
        },
        null,
        2
      ),
      'utf-8'
    )

    tables.projects[0] = {
      ...tables.projects[0],
      project_path: root,
      name: '旧名称',
      total_episodes: 2,
      config_json: JSON.stringify({
        projectName: '旧名称',
        totalEpisodes: 2,
        visualStyle: '旧风格',
        targetMedium: '旧媒介'
      })
    }

    const result = await queries.repairProjectIssues({
      projectPath: root,
      actionIds: ['apply_suggested_config'],
      trustMode: 'registered'
    })

    expect(result.appliedActions).toEqual(['apply_suggested_config'])
    expect(JSON.parse(String(tables.projects[0].config_json))).toMatchObject({
      projectName: '磁盘项目',
      totalEpisodes: 8,
      visualStyle: '写实',
      targetMedium: '短剧'
    })
    expect(tables.projects[0].name).toBe('磁盘项目')
    expect(Number(tables.projects[0].total_episodes)).toBe(8)
  })
})
