import { v4 as uuid } from 'uuid'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { getDatabase } from './database'
import {
  mergeProjectConfig,
  normalizeProjectConfig,
  readProjectConfigSync,
  saveProjectConfigSync
} from '../project/project-config-store'
import { projectEpisodes, type EpisodeProjection } from '../project/episode-projection'
import type { PersistedProjectConfig } from '../project/project-config-store'
import { listScriptEpisodeFiles } from '../project/script-file-utils'
import type {
  Project,
  ProjectConfig,
  ProjectSourceType,
  ProjectPhase,
  Episode,
  EpisodeStatus,
  Character,
  Scene,
  LLMConfig,
  ModelCategory,
  ReviewResult,
  PipelineRunRecord,
  PipelineRunDetail,
  PipelineRunPriority,
  PipelineRunStatus,
  PipelineDependencyCondition,
  PipelineRunTelemetrySummary,
  PipelineRuntimeTelemetrySummary,
  PipelineLLMCallRecord,
  LLMFailureClass,
  LLMCallStatus,
  LLMTelemetryTokenSource,
  PipelineLLMCallPhase,
  PipelineState,
  PipelineStage,
  LogEntry
} from '@shared/types'
import {
  DEFAULT_ADAPT_SETTINGS,
  DEFAULT_FLOW_CONFIG,
  DEFAULT_PROJECT_TASK_ALERTS,
  DEFAULT_PROJECT_TASK_DEFAULTS,
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_REVIEW_POLICY
} from '@shared/types'

const PROJECT_SOURCE_TYPES: ProjectSourceType[] = ['novel', 'script', 'original']
const PROJECT_PHASES: ProjectPhase[] = ['writing', 'production']

function isProjectSourceType(value: unknown): value is ProjectSourceType {
  return typeof value === 'string' && PROJECT_SOURCE_TYPES.includes(value as ProjectSourceType)
}

function isProjectPhase(value: unknown): value is ProjectPhase {
  return typeof value === 'string' && PROJECT_PHASES.includes(value as ProjectPhase)
}

function inferProjectSourceType(
  projectPath: string,
  config: Record<string, unknown>,
  fallback?: ProjectSourceType
): ProjectSourceType {
  if (isProjectSourceType(config.sourceType)) return config.sourceType
  if (isProjectSourceType(fallback)) return fallback
  if (existsSync(join(projectPath, 'novel')) || existsSync(join(projectPath, 'plot-breakdown.md'))) {
    return 'novel'
  }
  return 'script'
}

function inferProjectPhase(
  projectPath: string,
  sourceType: ProjectSourceType,
  config: Record<string, unknown>,
  fallback?: ProjectPhase
): ProjectPhase {
  if (isProjectPhase(config.phase)) return config.phase
  if (isProjectPhase(fallback)) return fallback

  if (sourceType === 'novel') {
    if (listScriptEpisodeFiles(projectPath).length > 0) return 'production'
    return 'writing'
  }

  return 'production'
}

// ==================== Projects ====================

export function createProject(data: {
  name: string
  sourceType?: ProjectSourceType
  phase?: ProjectPhase
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  novelTitle?: string
  novelGenre?: string
  config: Record<string, unknown>
}): Project {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  data.projectPath = resolve(data.projectPath)

  // === 项目目录初始化 ===
  const configPath = join(data.projectPath, 'project-config.json')
  const scriptDir = join(data.projectPath, 'script')

  // 如果 project-config.json 已存在，读取并使用其值
  if (existsSync(configPath)) {
    try {
      const config = readProjectConfigSync(data.projectPath)
      if (!config) throw new Error('config parse failed')
      const configRecord = config as unknown as Record<string, unknown>
      const sourceType = inferProjectSourceType(data.projectPath, configRecord, data.sourceType)
      const phase = inferProjectPhase(data.projectPath, sourceType, configRecord, data.phase)
      const novelTitle = typeof config.novelTitle === 'string' ? config.novelTitle : data.novelTitle
      const novelGenre = typeof config.novelGenre === 'string' ? config.novelGenre : data.novelGenre

      data.name = (config.projectName as string) || data.name
      data.visualStyle = (config.visualStyle as string) || data.visualStyle
      data.targetMedium = (config.targetMedium as string) || data.targetMedium
      data.totalEpisodes = (config.totalEpisodes as number) || data.totalEpisodes
      data.sourceType = sourceType
      data.phase = phase
      data.novelTitle = novelTitle
      data.novelGenre = novelGenre
      data.config = {
        ...configRecord,
        sourceType,
        phase,
        ...(novelTitle ? { novelTitle } : {}),
        ...(novelGenre ? { novelGenre } : {})
      }
    } catch { /* 解析失败则使用传入的参数 */ }
  } else {
    // 不存在则创建
    mkdirSync(data.projectPath, { recursive: true })
    const config = normalizeProjectConfig({
      projectName: data.name,
      totalEpisodes: data.totalEpisodes,
      visualStyle: data.visualStyle,
      targetMedium: data.targetMedium,
      sourceType: data.sourceType || 'script',
      phase: data.phase || 'production',
      workingDirectory: data.projectPath,
      createdAt: now,
      ...data.config
    })
    // 网文项目写入小说信息
    if (data.sourceType === 'novel') {
      if (data.novelTitle) config.novelTitle = data.novelTitle
      if (data.novelGenre) config.novelGenre = data.novelGenre
      config.originalContent = {
        ...(config.originalContent || {}),
        title: data.novelTitle || config.originalContent?.title,
        genre: data.novelGenre || config.originalContent?.genre,
        contentFormat: config.originalContent?.contentFormat || 'chapters'
      }
    }
    saveProjectConfigSync(data.projectPath, config)
    data.config = config as unknown as Record<string, unknown>
  }

  // 确保 script/ 和 outputs/ 目录存在
  mkdirSync(scriptDir, { recursive: true })
  mkdirSync(join(data.projectPath, 'outputs'), { recursive: true })

  // === 网文项目额外初始化（创建即初始化） ===
  if (data.sourceType === 'novel') {
    // 创建 novel/ 目录
    mkdirSync(join(data.projectPath, 'novel'), { recursive: true })
    // 创建 plot-breakdown.md（如果不存在）
    const pbPath = join(data.projectPath, 'plot-breakdown.md')
    if (!existsSync(pbPath) && data.novelTitle) {
      const header = `# 剧情拆解\n\n**小说名称**：《${data.novelTitle}》\n**小说类型**：${data.novelGenre || '未知'}\n\n---\n`
      writeFileSync(pbPath, header, 'utf-8')
    }
  }

  const existingProject = getProjectByPath(data.projectPath)
  if (existingProject) {
    db.prepare(`
      UPDATE projects
      SET name = ?, source_type = ?, phase = ?, visual_style = ?, target_medium = ?,
          total_episodes = ?, novel_title = ?, novel_genre = ?, config_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.name,
      data.sourceType || existingProject.sourceType,
      data.phase || existingProject.phase,
      data.visualStyle,
      data.targetMedium,
      data.totalEpisodes,
      data.novelTitle || null,
      data.novelGenre || null,
      JSON.stringify(data.config),
      now,
      existingProject.id
    )

    syncEpisodesFromFilesystem(existingProject.id, data.projectPath, data.totalEpisodes)
    return getProject(existingProject.id)!
  }

  db.prepare(`
    INSERT INTO projects (id, name, source_type, phase, visual_style, target_medium, project_path, total_episodes, novel_title, novel_genre, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.name,
    data.sourceType || 'script',
    data.phase || 'production',
    data.visualStyle,
    data.targetMedium,
    data.projectPath,
    data.totalEpisodes,
    data.novelTitle || null,
    data.novelGenre || null,
    JSON.stringify(data.config),
    now,
    now
  )

  // 自动扫描文件系统，创建 episode 记录
  syncEpisodesFromFilesystem(id, data.projectPath, data.totalEpisodes)

  return getProject(id)!
}

export function getProject(id: string): Project | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return mapProject(row)
}

export function listProjects(): Project[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Record<string, unknown>[]
  const seenPaths = new Set<string>()
  const projects: Project[] = []

  for (const row of rows) {
    const projectPath = row.project_path as string
    if (seenPaths.has(projectPath)) continue
    seenPaths.add(projectPath)
    projects.push(mapProject(row))
  }

  return projects
}

export function getProjectByPath(projectPath: string): Project | null {
  const db = getDatabase()
  const normalizedPath = resolve(projectPath)
  const row = db.prepare('SELECT * FROM projects WHERE project_path = ? ORDER BY updated_at DESC LIMIT 1')
    .get(normalizedPath) as Record<string, unknown> | undefined
  if (!row) return null
  return mapProject(row)
}

export function listProjectPaths(): string[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT project_path FROM projects').all() as Array<{ project_path: string }>
  return rows
    .map((row) => row.project_path)
    .filter((projectPath): projectPath is string => typeof projectPath === 'string' && projectPath.length > 0)
}

export function deleteProject(id: string): void {
  const db = getDatabase()
  const deleteProjectTxn = db.transaction((projectId: string) => {
    const episodeIds = db.prepare('SELECT id FROM episodes WHERE project_id = ?')
      .all(projectId) as { id: string }[]
    const runIds = db.prepare('SELECT run_id FROM pipeline_runs WHERE project_id = ?')
      .all(projectId) as { run_id: string }[]

    for (const { run_id } of runIds) {
      db.prepare('DELETE FROM pipeline_run_llm_calls WHERE run_id = ?').run(run_id)
      db.prepare('DELETE FROM pipeline_run_logs WHERE run_id = ?').run(run_id)
    }
    db.prepare('DELETE FROM pipeline_runs WHERE project_id = ?').run(projectId)

    db.prepare('DELETE FROM plot_points WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM adapt_batches WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM novels WHERE project_id = ?').run(projectId)

    for (const { id: episodeId } of episodeIds) {
      db.prepare('DELETE FROM reviews WHERE episode_id = ?').run(episodeId)
      db.prepare('DELETE FROM asset_references WHERE episode_id = ?').run(episodeId)
      db.prepare('DELETE FROM execution_logs WHERE episode_id = ?').run(episodeId)
    }
    db.prepare('DELETE FROM episodes WHERE project_id = ?').run(projectId)

    db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  })

  deleteProjectTxn(id)
}

function mapProject(row: Record<string, unknown>): Project {
  let persistedConfig: PersistedProjectConfig = normalizeProjectConfig({})
  if (row.config_json) {
    try {
      persistedConfig = normalizeProjectConfig(JSON.parse(row.config_json as string))
    } catch {
      persistedConfig = normalizeProjectConfig({})
    }
  }
  const config: ProjectConfig = {
    projectName: persistedConfig.projectName,
    sourceType: persistedConfig.sourceType,
    phase: persistedConfig.phase,
    templateProfileId: persistedConfig.templateProfileId,
    exportProfileId: persistedConfig.exportProfileId,
    totalEpisodes: persistedConfig.totalEpisodes,
    visualStyle: persistedConfig.visualStyle,
    targetMedium: persistedConfig.targetMedium,
    novelTitle: persistedConfig.novelTitle,
    novelGenre: persistedConfig.novelGenre,
    createdAt: persistedConfig.createdAt,
    ...(persistedConfig.pipelineSettings ? {
      pipelineSettings: { ...DEFAULT_PIPELINE_SETTINGS, ...persistedConfig.pipelineSettings }
    } : {}),
    ...(persistedConfig.adaptSettings ? {
      adaptSettings: { ...DEFAULT_ADAPT_SETTINGS, ...persistedConfig.adaptSettings }
    } : {}),
    ...(persistedConfig.reviewPolicy ? {
      reviewPolicy: { ...DEFAULT_REVIEW_POLICY, ...persistedConfig.reviewPolicy }
    } : {}),
    ...(persistedConfig.flowConfig ? {
      flowConfig: { ...DEFAULT_FLOW_CONFIG, ...persistedConfig.flowConfig }
    } : {}),
    ...(persistedConfig.taskDefaults ? {
      taskDefaults: { ...DEFAULT_PROJECT_TASK_DEFAULTS, ...persistedConfig.taskDefaults }
    } : {}),
    ...(persistedConfig.taskTemplates ? {
      taskTemplates: persistedConfig.taskTemplates
    } : {}),
    ...(persistedConfig.taskSchedules ? {
      taskSchedules: persistedConfig.taskSchedules
    } : {}),
    ...(persistedConfig.taskAlerts ? {
      taskAlerts: { ...DEFAULT_PROJECT_TASK_ALERTS, ...persistedConfig.taskAlerts }
    } : {})
  }

  return {
    id: row.id as string,
    name: row.name as string,
    sourceType: (row.source_type as ProjectSourceType) || 'script',
    phase: (row.phase as ProjectPhase) || 'production',
    visualStyle: row.visual_style as string,
    targetMedium: row.target_medium as string,
    projectPath: row.project_path as string,
    totalEpisodes: row.total_episodes as number,
    novelTitle: row.novel_title as string | undefined,
    novelGenre: row.novel_genre as string | undefined,
    config,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

/**
 * 更新项目阶段（编剧 → 制作）
 */
export function updateProjectPhase(id: string, phase: ProjectPhase): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const row = db.prepare('SELECT project_path, config_json FROM projects WHERE id = ?')
    .get(id) as { project_path?: string; config_json?: string | null } | undefined

  let storedConfig: Record<string, unknown> = {}
  if (row?.config_json) {
    try {
      storedConfig = JSON.parse(row.config_json) as Record<string, unknown>
    } catch {
      storedConfig = {}
    }
  }

  const nextConfig = mergeProjectConfig(storedConfig, { phase })

  db.prepare('UPDATE projects SET phase = ?, config_json = ?, updated_at = ? WHERE id = ?')
    .run(phase, JSON.stringify(nextConfig), now, id)

  if (row?.project_path) {
    try {
      saveProjectConfigSync(row.project_path, { phase })
    } catch {
      // 忽略文件回写失败，DB 仍作为主状态源
    }
  }
}

// ==================== Episodes ====================

export function createEpisode(data: {
  projectId: string
  episodeNumber: number
  title?: string
  scriptPath?: string
}): Episode {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO episodes (id, project_id, episode_number, title, script_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.projectId, data.episodeNumber, data.title || null, data.scriptPath || null, now, now)

  return getEpisode(id)!
}

export function getEpisode(id: string): Episode | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return mapEpisode(row)
}

export function listEpisodes(projectId: string): Episode[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_number').all(projectId) as Record<string, unknown>[]
  return rows.map(mapEpisode)
}

export function updateEpisodeStatus(id: string, status: EpisodeStatus): void {
  const db = getDatabase()
  db.prepare('UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id)
}

function mapEpisode(row: Record<string, unknown>): Episode {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    episodeNumber: row.episode_number as number,
    title: row.title as string,
    status: row.status as EpisodeStatus,
    scriptPath: row.script_path as string | undefined,
    directorAnalysisPath: row.director_analysis_path as string | undefined,
    artDesignPath: row.art_design_path as string | undefined,
    seedancePromptsPath: row.seedance_prompts_path as string | undefined,
    hasScript: (row.has_script as number) === 1,
    hasDirectorAnalysis: (row.has_director as number) === 1,
    hasArtDesign: (row.has_art as number) === 1,
    hasSeedancePrompts: (row.has_prompts as number) === 1,
    totalDurationSeconds: row.total_duration_seconds as number | undefined,
    totalPrompts: row.total_prompts as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function upsertEpisodeProjection(projectId: string, projection: EpisodeProjection, now: string): void {
  const db = getDatabase()

  db.prepare(`
    INSERT INTO episodes (
      id, project_id, episode_number, title, status, script_path, director_analysis_path,
      art_design_path, seedance_prompts_path, has_script, has_director, has_art, has_prompts,
      total_prompts, total_duration_seconds, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, episode_number) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      script_path = excluded.script_path,
      director_analysis_path = excluded.director_analysis_path,
      art_design_path = excluded.art_design_path,
      seedance_prompts_path = excluded.seedance_prompts_path,
      has_script = excluded.has_script,
      has_director = excluded.has_director,
      has_art = excluded.has_art,
      has_prompts = excluded.has_prompts,
      total_prompts = excluded.total_prompts,
      total_duration_seconds = excluded.total_duration_seconds,
      updated_at = excluded.updated_at
  `).run(
    uuid(),
    projectId,
    projection.episodeNumber,
    projection.title,
    projection.status,
    projection.scriptPath || null,
    projection.directorAnalysisPath || null,
    projection.artDesignPath || null,
    projection.seedancePromptsPath || null,
    projection.hasScript ? 1 : 0,
    projection.hasDirectorAnalysis ? 1 : 0,
    projection.hasArtDesign ? 1 : 0,
    projection.hasSeedancePrompts ? 1 : 0,
    projection.totalPrompts || null,
    projection.totalDurationSeconds || null,
    now,
    now
  )
}

function refreshEpisodesFromProjection(projectId: string, projectPath: string, totalEpisodesHint: number): void {
  const db = getDatabase()
  const now = new Date().toISOString()
  const projection = projectEpisodes(projectPath, totalEpisodesHint)

  for (const episode of projection.episodes) {
    upsertEpisodeProjection(projectId, episode, now)
  }

  if (projection.inferredTotalEpisodes > 0) {
    db.prepare('UPDATE projects SET total_episodes = ?, updated_at = ? WHERE id = ?')
      .run(projection.inferredTotalEpisodes, now, projectId)
  }
}

/**
 * 扫描文件系统，自动创建 episode 记录
 * 检测 outputs/epXX/ 和 script/epXX.md 判断集数和状态
 */
export function syncEpisodesFromFilesystem(projectId: string, projectPath: string, totalEpisodes: number): void {
  refreshEpisodesFromProjection(projectId, projectPath, totalEpisodes)
}

/**
 * 实时同步 episode 状态 — 扫描文件系统更新已有记录
 * 在进入项目、pipeline 完成后调用
 */
export function syncEpisodeStatus(projectId: string, projectPath: string): Episode[] {
  const db = getDatabase()

  // 漏洞补丁：首先获取项目主体的基础集数
  const proj = db.prepare('SELECT total_episodes, source_type FROM projects WHERE id = ?').get(projectId) as any
  let totalEps = proj?.total_episodes || 0

  refreshEpisodesFromProjection(projectId, projectPath, totalEps)

  // 返回更新后的列表
  return listEpisodes(projectId)
}

export function syncProjectConfigSnapshotByPath(projectPath: string, config: ProjectConfig | PersistedProjectConfig): Project | null {
  const db = getDatabase()
  const existing = getProjectByPath(projectPath)
  if (!existing) return null

  const now = new Date().toISOString()
  const sourceType = config.sourceType && isProjectSourceType(config.sourceType)
    ? config.sourceType
    : existing.sourceType
  const phase = config.phase && isProjectPhase(config.phase)
    ? config.phase
    : existing.phase
  const nextConfig = normalizeProjectConfig({
    ...config,
    sourceType,
    phase
  })

  db.prepare(`
    UPDATE projects
    SET name = ?, source_type = ?, phase = ?, visual_style = ?, target_medium = ?,
        total_episodes = ?, novel_title = ?, novel_genre = ?, config_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextConfig.projectName || existing.name,
    sourceType,
    phase,
    nextConfig.visualStyle,
    nextConfig.targetMedium,
    nextConfig.totalEpisodes || existing.totalEpisodes,
    nextConfig.novelTitle || null,
    nextConfig.novelGenre || null,
    JSON.stringify(nextConfig),
    now,
    existing.id
  )

  syncEpisodesFromFilesystem(existing.id, projectPath, nextConfig.totalEpisodes || existing.totalEpisodes)
  return getProject(existing.id)
}

// ==================== LLM Configs ====================

export function addLLMConfig(data: Omit<LLMConfig, 'id'>): LLMConfig {
  const db = getDatabase()
  const id = uuid()
  const category = data.category || 'llm'

  // 如果设为默认，先清除同类别的其他默认
  if (data.isDefault) {
    db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(category)
  }

  db.prepare(`
    INSERT INTO llm_configs (id, name, category, provider, base_url, api_key_encrypted, model, max_tokens, temperature, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, category, data.provider, data.baseUrl, data.apiKey, data.model, data.maxTokens, data.temperature, data.isDefault ? 1 : 0)

  return { ...data, id, category }
}

export function updateLLMConfig(id: string, data: Partial<Omit<LLMConfig, 'id'>>): void {
  const db = getDatabase()
  if (data.isDefault) {
    // 查当前记录的 category，按同类别清除默认
    const row = db.prepare('SELECT category FROM llm_configs WHERE id = ?').get(id) as { category: string } | undefined
    const category = data.category || row?.category || 'llm'
    db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(category)
  }
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
  if (data.provider !== undefined) { fields.push('provider = ?'); values.push(data.provider) }
  if (data.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(data.baseUrl) }
  if (data.apiKey !== undefined) { fields.push('api_key_encrypted = ?'); values.push(data.apiKey) }
  if (data.model !== undefined) { fields.push('model = ?'); values.push(data.model) }
  if (data.maxTokens !== undefined) { fields.push('max_tokens = ?'); values.push(data.maxTokens) }
  if (data.temperature !== undefined) { fields.push('temperature = ?'); values.push(data.temperature) }
  if (data.isDefault !== undefined) { fields.push('is_default = ?'); values.push(data.isDefault ? 1 : 0) }
  if (fields.length > 0) {
    values.push(id)
    db.prepare(`UPDATE llm_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }
}

export function listLLMConfigs(): LLMConfig[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM llm_configs ORDER BY category, is_default DESC, name').all() as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    name: row.name as string,
    category: (row.category as LLMConfig['category']) || 'llm',
    provider: row.provider as LLMConfig['provider'],
    baseUrl: row.base_url as string,
    apiKey: row.api_key_encrypted as string,
    model: row.model as string,
    maxTokens: row.max_tokens as number,
    temperature: row.temperature as number,
    isDefault: (row.is_default as number) === 1
  }))
}

export function getDefaultLLMConfig(category: ModelCategory = 'llm'): LLMConfig | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM llm_configs WHERE is_default = 1 AND category = ?').get(category) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    name: row.name as string,
    category: (row.category as LLMConfig['category']) || 'llm',
    provider: row.provider as LLMConfig['provider'],
    baseUrl: row.base_url as string,
    apiKey: row.api_key_encrypted as string,
    model: row.model as string,
    maxTokens: row.max_tokens as number,
    temperature: row.temperature as number,
    isDefault: true
  }
}

export function deleteLLMConfig(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM llm_configs WHERE id = ?').run(id)
}

// ==================== Reviews ====================

export function saveReview(data: {
  episodeId: string
  stage: string
  reviewType: string
  score: number
  result: string
  feedback: string
  issues: unknown[]
}): void {
  const db = getDatabase()
  const id = uuid()
  db.prepare(`
    INSERT INTO reviews (id, episode_id, stage, review_type, score, result, feedback, issues_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.episodeId, data.stage, data.reviewType, data.score, data.result, data.feedback, JSON.stringify(data.issues))
}

export function getReviews(episodeId: string): ReviewResult[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM reviews WHERE episode_id = ? ORDER BY created_at DESC').all(episodeId) as Record<string, unknown>[]
  return rows.map(row => {
    const result = row.result as ReviewResult['result']
    return {
      stage: row.stage as ReviewResult['stage'],
      reviewType: row.review_type as ReviewResult['reviewType'],
      result,
      passed: result === 'PASS',
      score: row.score as number,
      feedback: row.feedback as string,
      issues: row.issues_json ? JSON.parse(row.issues_json as string) : [],
      createdAt: row.created_at as string
    }
  })
}

export function setDefaultLLMConfig(id: string): void {
  const db = getDatabase()
  // 查出该记录的 category，只清除同类别的默认
  const row = db.prepare('SELECT category FROM llm_configs WHERE id = ?').get(id) as { category: string } | undefined
  const category = row?.category || 'llm'
  db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(category)
  db.prepare('UPDATE llm_configs SET is_default = 1 WHERE id = ?').run(id)
}

// ==================== Pipeline Runs ====================

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function mapPipelineRunTelemetry(row: Record<string, unknown>): PipelineRunTelemetrySummary {
  return {
    callCount: Number(row.llm_call_count ?? 0),
    successCount: Number(row.llm_success_count ?? 0),
    failureCount: Number(row.llm_failure_count ?? 0),
    totalDurationMs: Number(row.llm_total_duration_ms ?? 0),
    inputTokens: Number(row.llm_input_tokens ?? 0),
    outputTokens: Number(row.llm_output_tokens ?? 0),
    totalTokens: Number(row.llm_total_tokens ?? 0),
    estimatedCostUsd: Number(row.llm_estimated_cost_usd ?? 0),
    lastProvider: toOptionalString(row.llm_last_provider),
    lastModel: toOptionalString(row.llm_last_model),
    lastFailureClass: row.llm_last_failure_class as LLMFailureClass | undefined,
    lastCalledAt: toOptionalString(row.llm_last_called_at)
  }
}

function mapPipelineRun(row: Record<string, unknown>): PipelineRunRecord {
  return {
    runId: row.run_id as string,
    projectId: row.project_id as string,
    projectName: toOptionalString(row.project_name),
    projectPath: row.project_path as string,
    episodeNum: row.episode_number as number,
    currentStage: row.current_stage as PipelineStage,
    status: row.status as PipelineRunStatus,
    state: row.state as PipelineState,
    singleStage: (row.single_stage as number) === 1,
    queuedAt: row.queued_at as string,
    startedAt: toOptionalString(row.started_at),
    endedAt: toOptionalString(row.ended_at),
    lastUpdatedAt: row.last_updated_at as string,
    queuePosition: toOptionalNumber(row.queue_position),
    errorMessage: toOptionalString(row.error_message),
    batchId: toOptionalString(row.batch_id),
    batchLabel: toOptionalString(row.batch_label),
    priority: (row.priority as PipelineRunPriority) || 'normal',
    maxAutoRetries: Number(row.max_auto_retries ?? 0),
    attempt: Number(row.attempt ?? 0),
    rootRunId: (row.root_run_id as string) || (row.run_id as string),
    workerSlot: toOptionalNumber(row.worker_slot),
    archivedAt: toOptionalString(row.archived_at),
    deadLetteredAt: toOptionalString(row.dead_lettered_at),
    recoveryNote: toOptionalString(row.recovery_note),
    dependsOnRootRunId: toOptionalString(row.depends_on_root_run_id),
    triggerCondition: (row.trigger_condition as PipelineDependencyCondition) || 'always',
    scheduledAt: toOptionalString(row.scheduled_at),
    templateId: toOptionalString(row.template_id),
    templateLabel: toOptionalString(row.template_label),
    scheduleId: toOptionalString(row.schedule_id),
    scheduleLabel: toOptionalString(row.schedule_label),
    automationKey: toOptionalString(row.automation_key),
    telemetry: mapPipelineRunTelemetry(row)
  }
}

function mapPipelineRunLLMCall(row: Record<string, unknown>): PipelineLLMCallRecord {
  const inputTokens = toOptionalNumber(row.input_tokens)
  const outputTokens = toOptionalNumber(row.output_tokens)
  const totalTokens = toOptionalNumber(row.total_tokens)
  const tokenSource = toOptionalString(row.token_source) as LLMTelemetryTokenSource | undefined

  return {
    id: row.id as string,
    runId: row.run_id as string,
    stage: row.stage as PipelineStage,
    phase: row.phase as PipelineLLMCallPhase,
    provider: row.provider as string,
    model: row.model as string,
    status: row.status as LLMCallStatus,
    stream: (row.stream as number) === 1,
    startedAt: row.started_at as string,
    endedAt: toOptionalString(row.ended_at),
    durationMs: Number(row.duration_ms ?? 0),
    usage: inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined || tokenSource
      ? {
          inputTokens,
          outputTokens,
          totalTokens,
          tokenSource
        }
      : undefined,
    estimatedCostUsd: toOptionalNumber(row.estimated_cost_usd),
    failureClass: toOptionalString(row.failure_class) as LLMFailureClass | undefined,
    errorMessage: toOptionalString(row.error_message)
  }
}

export function upsertPipelineRun(data: PipelineRunRecord): PipelineRunRecord {
  const db = getDatabase()

  db.prepare(`
    INSERT INTO pipeline_runs (
      run_id, project_id, project_path, episode_number, current_stage, status, state,
      single_stage, queued_at, started_at, ended_at, last_updated_at, queue_position, error_message,
      batch_id, batch_label, priority, max_auto_retries, attempt, root_run_id, worker_slot, archived_at, dead_lettered_at, recovery_note,
      depends_on_root_run_id, trigger_condition, scheduled_at,
      template_id, template_label, schedule_id, schedule_label, automation_key,
      llm_call_count, llm_success_count, llm_failure_count, llm_input_tokens, llm_output_tokens, llm_total_tokens,
      llm_estimated_cost_usd, llm_total_duration_ms, llm_last_provider, llm_last_model, llm_last_failure_class, llm_last_called_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      project_id = excluded.project_id,
      project_path = excluded.project_path,
      episode_number = excluded.episode_number,
      current_stage = excluded.current_stage,
      status = excluded.status,
      state = excluded.state,
      single_stage = excluded.single_stage,
      queued_at = excluded.queued_at,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      last_updated_at = excluded.last_updated_at,
      queue_position = excluded.queue_position,
      error_message = excluded.error_message,
      batch_id = excluded.batch_id,
      batch_label = excluded.batch_label,
      priority = excluded.priority,
      max_auto_retries = excluded.max_auto_retries,
      attempt = excluded.attempt,
      root_run_id = excluded.root_run_id,
      worker_slot = excluded.worker_slot,
      archived_at = excluded.archived_at,
      dead_lettered_at = excluded.dead_lettered_at,
      recovery_note = excluded.recovery_note,
      depends_on_root_run_id = excluded.depends_on_root_run_id,
      trigger_condition = excluded.trigger_condition,
      scheduled_at = excluded.scheduled_at,
      template_id = excluded.template_id,
      template_label = excluded.template_label,
      schedule_id = excluded.schedule_id,
      schedule_label = excluded.schedule_label,
      automation_key = excluded.automation_key,
      llm_call_count = COALESCE(excluded.llm_call_count, pipeline_runs.llm_call_count, 0),
      llm_success_count = COALESCE(excluded.llm_success_count, pipeline_runs.llm_success_count, 0),
      llm_failure_count = COALESCE(excluded.llm_failure_count, pipeline_runs.llm_failure_count, 0),
      llm_input_tokens = COALESCE(excluded.llm_input_tokens, pipeline_runs.llm_input_tokens, 0),
      llm_output_tokens = COALESCE(excluded.llm_output_tokens, pipeline_runs.llm_output_tokens, 0),
      llm_total_tokens = COALESCE(excluded.llm_total_tokens, pipeline_runs.llm_total_tokens, 0),
      llm_estimated_cost_usd = COALESCE(excluded.llm_estimated_cost_usd, pipeline_runs.llm_estimated_cost_usd, 0),
      llm_total_duration_ms = COALESCE(excluded.llm_total_duration_ms, pipeline_runs.llm_total_duration_ms, 0),
      llm_last_provider = COALESCE(excluded.llm_last_provider, pipeline_runs.llm_last_provider),
      llm_last_model = COALESCE(excluded.llm_last_model, pipeline_runs.llm_last_model),
      llm_last_failure_class = COALESCE(excluded.llm_last_failure_class, pipeline_runs.llm_last_failure_class),
      llm_last_called_at = COALESCE(excluded.llm_last_called_at, pipeline_runs.llm_last_called_at)
  `).run(
    data.runId,
    data.projectId,
    data.projectPath,
    data.episodeNum,
    data.currentStage,
    data.status,
    data.state,
    data.singleStage ? 1 : 0,
    data.queuedAt,
    data.startedAt || null,
    data.endedAt || null,
    data.lastUpdatedAt,
    data.queuePosition || null,
    data.errorMessage || null,
    data.batchId || null,
    data.batchLabel || null,
    data.priority,
    data.maxAutoRetries,
    data.attempt,
    data.rootRunId,
    data.workerSlot || null,
    data.archivedAt || null,
    data.deadLetteredAt || null,
    data.recoveryNote || null,
    data.dependsOnRootRunId || null,
    data.triggerCondition,
    data.scheduledAt || null,
    data.templateId || null,
    data.templateLabel || null,
    data.scheduleId || null,
    data.scheduleLabel || null,
    data.automationKey || null,
    data.telemetry?.callCount ?? null,
    data.telemetry?.successCount ?? null,
    data.telemetry?.failureCount ?? null,
    data.telemetry?.inputTokens ?? null,
    data.telemetry?.outputTokens ?? null,
    data.telemetry?.totalTokens ?? null,
    data.telemetry?.estimatedCostUsd ?? null,
    data.telemetry?.totalDurationMs ?? null,
    data.telemetry?.lastProvider || null,
    data.telemetry?.lastModel || null,
    data.telemetry?.lastFailureClass || null,
    data.telemetry?.lastCalledAt || null
  )

  return data
}

export function updatePipelineRunPayload(runId: string, payload: Record<string, unknown>): void {
  const db = getDatabase()
  db.prepare('UPDATE pipeline_runs SET payload_json = ?, last_updated_at = ? WHERE run_id = ?')
    .run(JSON.stringify(payload), new Date().toISOString(), runId)
}

export function listPipelineRuns(projectId: string, limit = 20, includeArchived = false): PipelineRunRecord[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE pipeline_runs.project_id = ?
      AND (? = 1 OR pipeline_runs.archived_at IS NULL)
    ORDER BY COALESCE(started_at, queued_at) DESC
    LIMIT ?
  `).all(projectId, includeArchived ? 1 : 0, limit) as Record<string, unknown>[]

  return rows.map(mapPipelineRun)
}

export function listRecoverablePipelineRuns(): PipelineRunRecord[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE pipeline_runs.archived_at IS NULL
      AND pipeline_runs.status IN ('queued', 'running', 'paused', 'dead_letter')
    ORDER BY pipeline_runs.last_updated_at ASC
  `).all() as Record<string, unknown>[]

  return rows.map(mapPipelineRun)
}

export function listAllPipelineRuns(limit = 100, includeArchived = false): PipelineRunRecord[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE (? = 1 OR pipeline_runs.archived_at IS NULL)
    ORDER BY COALESCE(started_at, queued_at) DESC
    LIMIT ?
  `).all(includeArchived ? 1 : 0, limit) as Record<string, unknown>[]

  return rows.map(mapPipelineRun)
}

export function getPipelineRun(runId: string): PipelineRunRecord | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE pipeline_runs.run_id = ?
  `).get(runId) as Record<string, unknown> | undefined
  return row ? mapPipelineRun(row) : null
}

export function getLatestPipelineRunByRootRunId(rootRunId: string): PipelineRunRecord | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE pipeline_runs.root_run_id = ?
    ORDER BY pipeline_runs.attempt DESC, pipeline_runs.last_updated_at DESC
    LIMIT 1
  `).get(rootRunId) as Record<string, unknown> | undefined
  return row ? mapPipelineRun(row) : null
}

export function getPipelineRunByAutomationKey(automationKey: string): PipelineRunRecord | null {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT pipeline_runs.*, projects.name AS project_name
    FROM pipeline_runs
    LEFT JOIN projects ON projects.id = pipeline_runs.project_id
    WHERE pipeline_runs.automation_key = ?
    ORDER BY pipeline_runs.last_updated_at DESC
    LIMIT 1
  `).get(automationKey) as Record<string, unknown> | undefined
  return row ? mapPipelineRun(row) : null
}

export function savePipelineRunLog(runId: string, entry: LogEntry): void {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO pipeline_run_logs (id, run_id, stage, level, event_type, message, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    runId,
    String(entry.stage),
    entry.level,
    entry.eventType,
    entry.message,
    entry.timestamp
  )
}

export function savePipelineRunLLMCall(
  runId: string,
  call: Omit<PipelineLLMCallRecord, 'id' | 'runId'> & { id?: string }
): PipelineLLMCallRecord {
  const db = getDatabase()
  const record: PipelineLLMCallRecord = {
    ...call,
    id: call.id || uuid(),
    runId
  }

  const inputTokens = record.usage?.inputTokens ?? 0
  const outputTokens = record.usage?.outputTokens ?? 0
  const totalTokens = record.usage?.totalTokens ?? inputTokens + outputTokens
  const estimatedCostUsd = record.estimatedCostUsd ?? 0

  db.prepare(`
    INSERT INTO pipeline_run_llm_calls (
      id, run_id, stage, phase, provider, model, status, stream,
      started_at, ended_at, duration_ms, input_tokens, output_tokens, total_tokens,
      token_source, estimated_cost_usd, failure_class, error_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    runId,
    record.stage,
    record.phase,
    record.provider,
    record.model,
    record.status,
    record.stream ? 1 : 0,
    record.startedAt,
    record.endedAt || null,
    record.durationMs,
    inputTokens || null,
    outputTokens || null,
    totalTokens || null,
    record.usage?.tokenSource || null,
    estimatedCostUsd || null,
    record.failureClass || null,
    record.errorMessage || null
  )

  db.prepare(`
    UPDATE pipeline_runs
    SET
      llm_call_count = COALESCE(llm_call_count, 0) + 1,
      llm_success_count = COALESCE(llm_success_count, 0) + ?,
      llm_failure_count = COALESCE(llm_failure_count, 0) + ?,
      llm_input_tokens = COALESCE(llm_input_tokens, 0) + ?,
      llm_output_tokens = COALESCE(llm_output_tokens, 0) + ?,
      llm_total_tokens = COALESCE(llm_total_tokens, 0) + ?,
      llm_estimated_cost_usd = COALESCE(llm_estimated_cost_usd, 0) + ?,
      llm_total_duration_ms = COALESCE(llm_total_duration_ms, 0) + ?,
      llm_last_provider = ?,
      llm_last_model = ?,
      llm_last_failure_class = ?,
      llm_last_called_at = ?
    WHERE run_id = ?
  `).run(
    record.status === 'success' ? 1 : 0,
    record.status === 'failed' ? 1 : 0,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    record.durationMs,
    record.provider,
    record.model,
    record.failureClass || null,
    record.endedAt || record.startedAt,
    runId
  )

  return record
}

export function listPipelineRunLogs(runId: string, limit = 500): LogEntry[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT *
    FROM pipeline_run_logs
    WHERE run_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(runId, limit) as Record<string, unknown>[]

  return rows.map((row) => ({
    id: row.id as string,
    episodeId: '',
    stage: row.stage as PipelineStage,
    level: row.level as LogEntry['level'],
    eventType: row.event_type as string,
    message: row.message as string,
    timestamp: row.timestamp as string
  }))
}

export function listPipelineRunLLMCalls(runId: string, limit = 200): PipelineLLMCallRecord[] {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT *
    FROM pipeline_run_llm_calls
    WHERE run_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(runId, limit) as Record<string, unknown>[]

  return rows.map(mapPipelineRunLLMCall)
}

export function getPipelineRunDetail(runId: string): PipelineRunDetail | null {
  const run = getPipelineRun(runId)
  if (!run) return null
  return {
    run,
    logs: listPipelineRunLogs(runId),
    llmCalls: listPipelineRunLLMCalls(runId)
  }
}

export function getPipelineRuntimeTelemetrySummary(includeArchived = false): PipelineRuntimeTelemetrySummary {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT
      COUNT(*) AS run_count,
      COALESCE(SUM(llm_call_count), 0) AS call_count,
      COALESCE(SUM(llm_success_count), 0) AS success_count,
      COALESCE(SUM(llm_failure_count), 0) AS failure_count,
      COALESCE(SUM(llm_total_duration_ms), 0) AS total_duration_ms,
      COALESCE(SUM(llm_total_tokens), 0) AS total_tokens,
      COALESCE(SUM(llm_estimated_cost_usd), 0) AS estimated_cost_usd,
      MAX(llm_last_called_at) AS last_called_at
    FROM pipeline_runs
    WHERE (? = 1 OR archived_at IS NULL)
  `).get(includeArchived ? 1 : 0) as Record<string, unknown>

  return {
    runCount: Number(row.run_count ?? 0),
    callCount: Number(row.call_count ?? 0),
    successCount: Number(row.success_count ?? 0),
    failureCount: Number(row.failure_count ?? 0),
    totalDurationMs: Number(row.total_duration_ms ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    lastCalledAt: toOptionalString(row.last_called_at)
  }
}

export function listQueuedPipelineRuns(): Array<PipelineRunRecord & { payload: Record<string, unknown> | null }> {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT *
    FROM pipeline_runs
    WHERE status = 'queued' AND archived_at IS NULL
    ORDER BY
      CASE priority
        WHEN 'high' THEN 0
        WHEN 'normal' THEN 1
        ELSE 2
      END ASC,
      queue_position ASC,
      queued_at ASC
  `).all() as Record<string, unknown>[]

  return rows.map((row) => {
    let payload: Record<string, unknown> | null = null
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json as string) as Record<string, unknown>
      } catch {
        payload = null
      }
    }
    return {
      ...mapPipelineRun(row),
      payload
    }
  })
}

export function nextPipelineQueuePosition(): number {
  const db = getDatabase()
  const row = db.prepare(`
    SELECT MAX(queue_position) AS max_position
    FROM pipeline_runs
    WHERE status = 'queued' AND archived_at IS NULL
  `).get() as { max_position?: number | null }

  return (row?.max_position || 0) + 1
}

export function cancelQueuedPipelineRun(runId: string, reason?: string): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE pipeline_runs
    SET status = 'aborted',
        state = 'idle',
        queue_position = NULL,
        ended_at = ?,
        last_updated_at = ?,
        recovery_note = NULL,
        error_message = COALESCE(?, error_message)
    WHERE run_id = ? AND status = 'queued'
  `).run(new Date().toISOString(), new Date().toISOString(), reason || null, runId)
}

export function updatePipelineRunQueuePosition(runId: string, queuePosition: number | null): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE pipeline_runs
    SET queue_position = ?, last_updated_at = ?
    WHERE run_id = ?
  `).run(queuePosition, new Date().toISOString(), runId)
}

export function touchPipelineRunHeartbeat(runId: string, timestamp = new Date().toISOString()): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE pipeline_runs
    SET last_updated_at = ?
    WHERE run_id = ?
  `).run(timestamp, runId)
}

export function markPipelineRunDeadLetter(runId: string, reason: string, options?: {
  state?: PipelineState
  endedAt?: string
}): PipelineRunRecord | null {
  const db = getDatabase()
  const now = options?.endedAt || new Date().toISOString()
  db.prepare(`
    UPDATE pipeline_runs
    SET status = 'dead_letter',
        state = ?,
        ended_at = COALESCE(ended_at, ?),
        last_updated_at = ?,
        queue_position = NULL,
        dead_lettered_at = ?,
        recovery_note = ?,
        error_message = COALESCE(error_message, ?)
    WHERE run_id = ?
      AND archived_at IS NULL
      AND status != 'completed'
  `).run(options?.state || 'error', now, now, now, reason, reason, runId)
  return getPipelineRun(runId)
}

export function getPipelineRunPayload(runId: string): Record<string, unknown> | null {
  const db = getDatabase()
  const row = db.prepare('SELECT payload_json FROM pipeline_runs WHERE run_id = ?').get(runId) as {
    payload_json?: string | null
  } | undefined

  if (!row?.payload_json) return null

  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function archivePipelineRuns(olderThanDays: number, projectId?: string): number {
  const db = getDatabase()
  const threshold = `-${Math.max(0, olderThanDays)} days`
  const now = new Date().toISOString()
  const result = projectId
    ? db.prepare(`
      UPDATE pipeline_runs
      SET archived_at = ?, last_updated_at = ?
      WHERE archived_at IS NULL
        AND project_id = ?
        AND status IN ('completed', 'failed', 'aborted')
        AND datetime(COALESCE(ended_at, last_updated_at)) <= datetime('now', ?)
    `).run(now, now, projectId, threshold)
    : db.prepare(`
      UPDATE pipeline_runs
      SET archived_at = ?, last_updated_at = ?
      WHERE archived_at IS NULL
        AND status IN ('completed', 'failed', 'aborted')
        AND datetime(COALESCE(ended_at, last_updated_at)) <= datetime('now', ?)
    `).run(now, now, threshold)

  return Number(result.changes || 0)
}
