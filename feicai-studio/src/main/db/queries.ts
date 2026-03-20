import { v4 as uuid } from 'uuid'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDatabase } from './database'
import type {
  Project,
  ProjectSourceType,
  ProjectPhase,
  Episode,
  EpisodeStatus,
  Character,
  Scene,
  LLMConfig,
  ModelCategory,
  ReviewResult
} from '@shared/types'

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

  // === 项目目录初始化 ===
  const configPath = join(data.projectPath, 'project-config.json')
  const scriptDir = join(data.projectPath, 'script')

  // 如果 project-config.json 已存在，读取并使用其值
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw) as Record<string, unknown>
      data.name = (config.projectName as string) || data.name
      data.visualStyle = (config.visualStyle as string) || data.visualStyle
      data.targetMedium = (config.targetMedium as string) || data.targetMedium
      data.totalEpisodes = (config.totalEpisodes as number) || data.totalEpisodes
      data.config = config
    } catch { /* 解析失败则使用传入的参数 */ }
  } else {
    // 不存在则创建
    mkdirSync(data.projectPath, { recursive: true })
    const config = {
      projectName: data.name,
      totalEpisodes: data.totalEpisodes,
      visualStyle: data.visualStyle,
      targetMedium: data.targetMedium,
      createdAt: now
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    data.config = config
  }

  // 确保 script/ 目录存在
  mkdirSync(scriptDir, { recursive: true })

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
  return rows.map(mapProject)
}

export function deleteProject(id: string): void {
  const db = getDatabase()
  // 获取该项目的所有 episode id
  const episodeIds = db.prepare('SELECT id FROM episodes WHERE project_id = ?')
    .all(id) as { id: string }[]

  // 级联删除关联数据
  for (const ep of episodeIds) {
    db.prepare('DELETE FROM reviews WHERE episode_id = ?').run(ep.id)
    db.prepare('DELETE FROM asset_references WHERE episode_id = ?').run(ep.id)
    db.prepare('DELETE FROM execution_logs WHERE episode_id = ?').run(ep.id)
  }
  db.prepare('DELETE FROM episodes WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM characters WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM scenes WHERE project_id = ?').run(id)
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

function mapProject(row: Record<string, unknown>): Project {
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
    config: row.config_json ? JSON.parse(row.config_json as string) : {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

/**
 * 更新项目阶段（编剧 → 制作）
 */
export function updateProjectPhase(id: string, phase: ProjectPhase): void {
  const db = getDatabase()
  db.prepare('UPDATE projects SET phase = ?, updated_at = ? WHERE id = ?')
    .run(phase, new Date().toISOString(), id)
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

/**
 * 扫描文件系统，自动创建 episode 记录
 * 检测 outputs/epXX/ 和 script/epXX.md 判断集数和状态
 */
export function syncEpisodesFromFilesystem(projectId: string, projectPath: string, totalEpisodes: number): void {
  const db = getDatabase()
  const now = new Date().toISOString()

  // 扫描 outputs 目录和 script 目录
  const outputsDir = join(projectPath, 'outputs')
  const scriptDir = join(projectPath, 'script')

  // 确定集数范围
  const episodeNums = new Set<number>()

  // 从 outputs/ 扫描
  if (existsSync(outputsDir)) {
    for (const entry of readdirSync(outputsDir)) {
      const match = entry.match(/^ep(\d+)$/)
      if (match) episodeNums.add(parseInt(match[1]))
    }
  }

  // 从 script/ 扫描
  if (existsSync(scriptDir)) {
    for (const entry of readdirSync(scriptDir)) {
      const match = entry.match(/^ep(\d+)\.md$/)
      if (match) episodeNums.add(parseInt(match[1]))
    }
  }

  // 如果没扫描到任何集数，用 totalEpisodes 生成
  if (episodeNums.size === 0 && totalEpisodes > 0) {
    for (let i = 1; i <= totalEpisodes; i++) episodeNums.add(i)
  }

  // 创建每一集的记录
  const sortedNums = [...episodeNums].sort((a, b) => a - b)
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO episodes (id, project_id, episode_number, title, status, script_path, director_analysis_path, art_design_path, seedance_prompts_path, has_script, has_director, has_art, has_prompts, total_prompts, total_duration_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const num of sortedNums) {
    const epStr = String(num).padStart(3, '0')
    const scriptPath = join(scriptDir, `ep${epStr}.md`)
    const directorPath = join(outputsDir, `ep${epStr}`, '01-director-analysis.md')
    const artPath = join(outputsDir, `ep${epStr}`, '01.5-art-design-output.md')
    const promptsPath = join(outputsDir, `ep${epStr}`, '02-seedance-prompts.md')

    const hasScript = existsSync(scriptPath)
    const hasDirector = existsSync(directorPath)
    const hasArt = existsSync(artPath)
    const hasPrompts = existsSync(promptsPath)

    // 判断状态
    let status: EpisodeStatus = 'idle'
    if (hasPrompts && hasDirector) {
      status = 'complete'
    } else if (hasArt) {
      status = 'art'
    } else if (hasDirector) {
      status = 'director'
    }

    // 解析提示词文件
    let totalPrompts = 0
    let totalDuration = 0
    if (hasPrompts) {
      try {
        const raw = readFileSync(promptsPath, 'utf-8')
        const sections = raw.split(/^## /m).slice(1)
        totalPrompts = sections.filter(s => s.trim().length > 0).length
        for (const section of sections) {
          const durMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i)
            || section.match(/建议时长[：:]\s*(\d+)/i)
            || section.match(/(\d+)\s*[秒s]/i)
          if (durMatch) totalDuration += parseInt(durMatch[1])
        }
      } catch { /* ignore read errors */ }
    }

    insertStmt.run(
      uuid(), projectId, num,
      `第${num}集`,
      status,
      hasScript ? scriptPath : null,
      hasDirector ? directorPath : null,
      hasArt ? artPath : null,
      hasPrompts ? promptsPath : null,
      hasScript ? 1 : 0,
      hasDirector ? 1 : 0,
      hasArt ? 1 : 0,
      hasPrompts ? 1 : 0,
      totalPrompts > 0 ? totalPrompts : null,
      totalDuration > 0 ? totalDuration : null,
      now, now
    )
  }

  // 更新项目的 totalEpisodes
  if (sortedNums.length > 0 && sortedNums.length !== totalEpisodes) {
    db.prepare('UPDATE projects SET total_episodes = ? WHERE id = ?')
      .run(sortedNums.length, projectId)
  }
}

/**
 * 实时同步 episode 状态 — 扫描文件系统更新已有记录
 * 在进入项目、pipeline 完成后调用
 */
export function syncEpisodeStatus(projectId: string, projectPath: string): Episode[] {
  const db = getDatabase()
  const outputsDir = join(projectPath, 'outputs')
  const scriptDir = join(projectPath, 'script')
  const now = new Date().toISOString()

  const episodes = db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_number')
    .all(projectId) as Record<string, unknown>[]

  const updateStmt = db.prepare(`
    UPDATE episodes SET
      status = ?, script_path = ?, director_analysis_path = ?, art_design_path = ?, seedance_prompts_path = ?,
      has_script = ?, has_director = ?, has_art = ?, has_prompts = ?,
      total_prompts = ?, total_duration_seconds = ?, updated_at = ?
    WHERE id = ?
  `)

  for (const row of episodes) {
    const num = row.episode_number as number
    const epStr = String(num).padStart(3, '0')

    const scriptPath = join(scriptDir, `ep${epStr}.md`)
    const directorPath = join(outputsDir, `ep${epStr}`, '01-director-analysis.md')
    const artPath = join(outputsDir, `ep${epStr}`, '01.5-art-design-output.md')
    const promptsPath = join(outputsDir, `ep${epStr}`, '02-seedance-prompts.md')

    const hasScript = existsSync(scriptPath)
    const hasDirector = existsSync(directorPath)
    const hasArt = existsSync(artPath)
    const hasPrompts = existsSync(promptsPath)

    // 判断状态
    let status: EpisodeStatus = 'idle'
    if (hasPrompts && hasDirector) {
      status = 'complete'
    } else if (hasArt) {
      status = 'art'
    } else if (hasDirector) {
      status = 'director'
    }

    // 解析提示词
    let totalPrompts = 0
    let totalDuration = 0
    if (hasPrompts) {
      try {
        const raw = readFileSync(promptsPath, 'utf-8')
        const sections = raw.split(/^## /m).slice(1)
        totalPrompts = sections.filter(s => s.trim().length > 0).length
        for (const section of sections) {
          const durMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i)
            || section.match(/建议时长[：:]\s*(\d+)/i)
            || section.match(/(\d+)\s*[秒s]/i)
          if (durMatch) totalDuration += parseInt(durMatch[1])
        }
      } catch { /* ignore */ }
    }

    updateStmt.run(
      status,
      hasScript ? scriptPath : null,
      hasDirector ? directorPath : null,
      hasArt ? artPath : null,
      hasPrompts ? promptsPath : null,
      hasScript ? 1 : 0,
      hasDirector ? 1 : 0,
      hasArt ? 1 : 0,
      hasPrompts ? 1 : 0,
      totalPrompts > 0 ? totalPrompts : null,
      totalDuration > 0 ? totalDuration : null,
      now,
      row.id as string
    )
  }

  // 返回更新后的列表
  return listEpisodes(projectId)
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
