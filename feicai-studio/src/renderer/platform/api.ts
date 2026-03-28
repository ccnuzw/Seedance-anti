import { IPC } from '@shared/ipc-channels'
import {
  getWebTransportConfig,
  invokeRemoteChannel,
  subscribeRemoteChannel
} from './webTransport'
import type {
  AppDeliveryIssue,
  AppDeliveryStatus,
  AdaptPlan,
  AdaptState,
  Character,
  Episode,
  LLMConfig,
  LLMProviderType,
  NovelInfo,
  PipelineRuntimeDiagnostics,
  PlotPoint,
  PipelineRunRecord,
  Project,
  ProjectConfig,
  ProjectPhase,
  ProjectSourceType,
  Scene,
  WaterLevel
} from '@shared/types'

type PlatformChannel = string
type PlatformListener = (...args: unknown[]) => void

interface PlatformCapabilities {
  desktopBridge: boolean
  llmSettings: boolean
  deliveryStatus: boolean
  projectFilesystem: boolean
  pipelineRuntime: boolean
}

export interface PlatformAPI {
  readonly isDesktopBridgeAvailable: boolean
  readonly isWebPreview: boolean
  readonly capabilities: PlatformCapabilities
  invoke: (channel: PlatformChannel, ...args: unknown[]) => Promise<unknown>
  on: (channel: PlatformChannel, callback: PlatformListener) => () => void
  once: (channel: PlatformChannel, callback: PlatformListener) => void
}

const WEB_STORAGE_KEYS = {
  llmConfigs: 'feicai-web-llm-configs',
  projects: 'feicai-web-projects',
  files: 'feicai-web-files'
} as const

interface VirtualFileMap {
  [path: string]: string
}

interface WebProjectBundle {
  version: 1
  exportedAt: string
  project: Project
  files: VirtualFileMap
}

interface ImportedChapterPayload {
  chapterNum: number
  title?: string
  content: string
}

function createUnavailableError(channel: string): Error {
  return new Error(`Web preview does not support channel: ${channel}`)
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    window.localStorage.removeItem(key)
    return fallback
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function getStoredLLMConfigs(): LLMConfig[] {
  return readJSON<LLMConfig[]>(WEB_STORAGE_KEYS.llmConfigs, [])
}

function setStoredLLMConfigs(configs: LLMConfig[]): void {
  writeJSON(WEB_STORAGE_KEYS.llmConfigs, configs)
}

function getStoredProjects(): Project[] {
  return readJSON<Project[]>(WEB_STORAGE_KEYS.projects, [])
}

function setStoredProjects(projects: Project[]): void {
  writeJSON(WEB_STORAGE_KEYS.projects, projects)
}

function getStoredFiles(): VirtualFileMap {
  return readJSON<VirtualFileMap>(WEB_STORAGE_KEYS.files, {})
}

function setStoredFiles(files: VirtualFileMap): void {
  writeJSON(WEB_STORAGE_KEYS.files, files)
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\/+$/, '')
}

function buildVirtualProjectPath(projectId: string): string {
  return `web://project/${projectId}`
}

function buildScriptPath(projectPath: string, episodeNum: number): string {
  return `${normalizeProjectPath(projectPath)}/script/EP${String(episodeNum).padStart(3, '0')}.md`
}

function buildPromptPath(projectPath: string, episodeNum: number, kind: string): string {
  return `${normalizeProjectPath(projectPath)}/prompts/EP${String(episodeNum).padStart(3, '0')}.${kind}.md`
}

function buildDirectorAnalysisPath(projectPath: string, episodeNum: number): string {
  return `${normalizeProjectPath(projectPath)}/analysis/EP${String(episodeNum).padStart(3, '0')}.director.md`
}

function buildAssetPromptPath(projectPath: string, assetType: 'character' | 'scene'): string {
  return `${normalizeProjectPath(projectPath)}/assets/${assetType}-prompts.json`
}

function resolvePromptArtifactPath(projectPath: string, episodeNum: number, kind: string): string {
  if (kind === 'director') return buildDirectorAnalysisPath(projectPath, episodeNum)
  return buildPromptPath(projectPath, episodeNum, kind)
}

function readPromptArtifact(projectPath: string, episodeNum: number, kind: string): string | null {
  const files = getStoredFiles()
  const primary = files[resolvePromptArtifactPath(projectPath, episodeNum, kind)]
  if (typeof primary === 'string') return primary
  if (kind === 'art') {
    return files[buildPromptPath(projectPath, episodeNum, 'prompts')] || null
  }
  return null
}

function buildNovelChapterPath(projectPath: string, chapterNum: number): string {
  return `${normalizeProjectPath(projectPath)}/novel/chapter-${String(chapterNum).padStart(4, '0')}.txt`
}

function buildNovelContentPath(projectPath: string): string {
  return `${normalizeProjectPath(projectPath)}/novel/original-content.md`
}

function buildPlotBreakdownPath(projectPath: string): string {
  return `${normalizeProjectPath(projectPath)}/plot/plot-breakdown.json`
}

function createEpisode(project: Project, episodeNumber: number, files: VirtualFileMap): Episode {
  const scriptPath = buildScriptPath(project.projectPath, episodeNumber)
  const promptsPath = buildPromptPath(project.projectPath, episodeNumber, 'prompts')
  const hasScript = typeof files[scriptPath] === 'string' && files[scriptPath].trim().length > 0
  const hasSeedancePrompts = typeof files[promptsPath] === 'string' && files[promptsPath].trim().length > 0
  return {
    id: `${project.id}:ep:${episodeNumber}`,
    projectId: project.id,
    episodeNumber,
    title: `第 ${episodeNumber} 集`,
    status: hasSeedancePrompts ? 'complete' : 'idle',
    scriptPath: hasScript ? scriptPath : undefined,
    seedancePromptsPath: hasSeedancePrompts ? promptsPath : undefined,
    hasScript,
    hasDirectorAnalysis: false,
    hasArtDesign: false,
    hasSeedancePrompts,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
}

function listVirtualEpisodes(project: Project): Episode[] {
  const files = getStoredFiles()
  const totalEpisodes = Math.max(project.totalEpisodes || 0, 1)
  return Array.from({ length: totalEpisodes }, (_, index) => createEpisode(project, index + 1, files))
}

function listVirtualScriptDocs(projectPath: string): Array<{ episode: number; filename: string; content: string }> {
  const files = getStoredFiles()
  const base = `${normalizeProjectPath(projectPath)}/script/`
  return Object.entries(files)
    .filter(([path, content]) => path.startsWith(base) && typeof content === 'string')
    .map(([path, content]) => {
      const match = path.match(/EP(\d+)\.md$/i)
      const episode = match ? Number.parseInt(match[1], 10) : 0
      return {
        episode,
        filename: path.split('/').pop() || `EP${String(episode).padStart(3, '0')}.md`,
        content
      }
    })
    .filter((item) => item.episode > 0)
    .sort((a, b) => a.episode - b.episode)
}

function listVirtualPromptDocs(
  projectPath: string,
  episodeRange?: number[],
  kind = 'prompts'
): Array<{ episode: number; filename: string; content: string }> {
  const files = getStoredFiles()
  const allowed = episodeRange ? new Set(episodeRange) : null
  const base = `${normalizeProjectPath(projectPath)}/prompts/`
  return Object.entries(files)
    .filter(([path, content]) => path.startsWith(base) && path.endsWith(`.${kind}.md`) && typeof content === 'string')
    .map(([path, content]) => {
      const match = path.match(/EP(\d+)\./i)
      const episode = match ? Number.parseInt(match[1], 10) : 0
      return {
        episode,
        filename: path.split('/').pop() || `EP${String(episode).padStart(3, '0')}.${kind}.md`,
        content
      }
    })
    .filter((item) => item.episode > 0 && (!allowed || allowed.has(item.episode)))
    .sort((a, b) => a.episode - b.episode)
}

function listVirtualNovelDocs(projectPath: string): Array<{ chapterNum: number; filename: string; content: string }> {
  const files = getStoredFiles()
  const base = `${normalizeProjectPath(projectPath)}/novel/`
  return Object.entries(files)
    .filter(([path, content]) => path.startsWith(base) && path.endsWith('.txt') && typeof content === 'string')
    .map(([path, content]) => {
      const match = path.match(/chapter-(\d+)\.txt$/i)
      const chapterNum = match ? Number.parseInt(match[1], 10) : 0
      return {
        chapterNum,
        filename: path.split('/').pop() || `chapter-${String(chapterNum).padStart(4, '0')}.txt`,
        content
      }
    })
    .filter((item) => item.chapterNum > 0)
    .sort((a, b) => a.chapterNum - b.chapterNum)
}

function parsePromptMarkdown(raw: string): Array<{
  index: number
  title: string
  content: string
  duration: number
  references: Array<{ referenceTag: string; assetType: string }>
}> {
  if (!raw) return []
  const sections = raw.split(/^## /m).slice(1)
  return sections.map((section, idx) => {
    const lines = section.trim().split('\n')
    const title = lines[0]?.trim() || `提示词 ${idx + 1}`
    const durationMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i) || section.match(/(\d+)\s*[秒s]/i)
    const duration = durationMatch ? parseInt(durationMatch[1]) : 5
    const content = lines
      .slice(1)
      .filter((line) => !line.startsWith('**') && line.trim().length > 0)
      .join('\n')
      .trim()
    const references: Array<{ referenceTag: string; assetType: string }> = []
    const refMatches = section.matchAll(/@(图片\d+|场景图\d+)/g)
    for (const match of refMatches) {
      references.push({
        referenceTag: match[0],
        assetType: match[1].startsWith('场景') ? 'scene' : 'character'
      })
    }
    return { index: idx, title, content, duration, references }
  }).filter((item) => item.content.length > 0)
}

function readAssetPromptOverrides(projectPath: string, assetType: 'character' | 'scene'): Record<string, string> {
  const raw = getStoredFiles()[buildAssetPromptPath(projectPath, assetType)]
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function buildVirtualAssets(project: Project): { characters: Character[]; scenes: Scene[] } {
  const promptDocs = listVirtualPromptDocs(project.projectPath)
  const prompts = promptDocs.flatMap((doc) => parsePromptMarkdown(doc.content))
  const characterOverrides = readAssetPromptOverrides(project.projectPath, 'character')
  const sceneOverrides = readAssetPromptOverrides(project.projectPath, 'scene')
  const characters = new Map<string, Character>()
  const scenes = new Map<string, Scene>()

  prompts.forEach((prompt) => {
    const characterRefs = prompt.references.filter((ref) => ref.assetType === 'character')
    const sceneRefs = prompt.references.filter((ref) => ref.assetType === 'scene')
    if (characterRefs.length === 0 && prompt.title.includes('人物')) {
      characterRefs.push({ referenceTag: '@图片1', assetType: 'character' })
    }
    if (sceneRefs.length === 0 && (prompt.title.includes('场景') || prompt.title.includes('镜头'))) {
      sceneRefs.push({ referenceTag: '@场景图1', assetType: 'scene' })
    }

    characterRefs.forEach((ref) => {
      if (characters.has(ref.referenceTag)) return
      characters.set(ref.referenceTag, {
        id: `${project.id}-character-${ref.referenceTag.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        projectId: project.id,
        name: ref.referenceTag.replace('@', ''),
        alias: prompt.title,
        appearance: '来自当前提示词引用',
        promptText: characterOverrides[ref.referenceTag] || `${prompt.title}\n\n${prompt.content}`.trim(),
        firstEpisode: 1,
        isVariant: false,
        createdAt: project.createdAt
      })
    })

    sceneRefs.forEach((ref) => {
      if (scenes.has(ref.referenceTag)) return
      scenes.set(ref.referenceTag, {
        id: `${project.id}-scene-${ref.referenceTag.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        projectId: project.id,
        name: ref.referenceTag.replace('@', ''),
        timeOfDay: '未标注',
        atmosphere: prompt.title,
        promptText: sceneOverrides[ref.referenceTag] || `${prompt.title}\n\n${prompt.content}`.trim(),
        createdAt: project.createdAt
      })
    })
  })

  return {
    characters: [...characters.values()],
    scenes: [...scenes.values()]
  }
}

function getNovelInfo(project: Project): NovelInfo | null {
  const chapters = listVirtualNovelDocs(project.projectPath)
  if (chapters.length === 0) return null
  return {
    title: project.novelTitle || project.config.projectName || project.name,
    genre: project.novelGenre || '未分类',
    totalChapters: chapters.length,
    chaptersDir: `${normalizeProjectPath(project.projectPath)}/novel`
  }
}

function buildDerivedBreakdown(project: Project): {
  data: { title: string; genre: string; batches: Array<{ batchNumber: number; chapterStart: number; chapterEnd: number; plots: PlotPoint[] }>; allPlots: PlotPoint[] }
  raw: string
} {
  const chapters = listVirtualNovelDocs(project.projectPath)
  const allPlots: PlotPoint[] = chapters.map((chapter, index) => ({
    id: index + 1,
    scene: `第${chapter.chapterNum}章`,
    description: chapter.content.trim().slice(0, 80) || chapter.filename,
    hookType: 'chapter',
    episode: Math.max(1, Math.ceil((index + 1) / 3)),
    status: 'unused',
    batch: Math.max(1, Math.ceil((index + 1) / 6))
  }))
  const batches = Array.from(new Set(allPlots.map((plot) => plot.batch))).map((batchNumber) => {
    const plots = allPlots.filter((plot) => plot.batch === batchNumber)
    return {
      batchNumber,
      chapterStart: plots[0]?.id || 0,
      chapterEnd: plots[plots.length - 1]?.id || 0,
      plots
    }
  })
  const data = {
    title: project.novelTitle || project.name,
    genre: project.novelGenre || '未分类',
    batches,
    allPlots
  }
  const raw = [
    `# ${data.title} Plot Breakdown`,
    '',
    `## 改编规划`,
    '',
    chapters.length > 0 ? `共 ${chapters.length} 章，当前按每 3 章约映射 1 集、每 6 章分为 1 个批次。` : '暂无章节。',
    '',
    '## 剧情点清单',
    '',
    ...allPlots.map((plot) => `- 第${plot.id}章 -> EP${String(plot.episode).padStart(3, '0')}：${plot.description}`)
  ].join('\n')
  return { data, raw }
}

function readStoredPlan(projectPath: string): AdaptPlan | null {
  const raw = getStoredFiles()[buildPlanPath(projectPath)]
  if (!raw) return null
  try {
    return JSON.parse(raw) as AdaptPlan
  } catch {
    return null
  }
}

function buildWaterLevel(project: Project): WaterLevel {
  const chapters = listVirtualNovelDocs(project.projectPath)
  const scripts = listVirtualScriptDocs(project.projectPath)
  const totalChapters = chapters.length
  const processedChapters = chapters.length > 0 ? chapters.length : 0
  return {
    unusedPlots: totalChapters,
    unprocessedChapters: 0,
    completedEpisodes: 0,
    totalPlots: totalChapters,
    totalChapters,
    processedChapters,
    assignedEpisodes: Math.ceil(totalChapters / 3),
    scriptEpisodes: scripts.length,
    pendingScriptEpisodes: Math.max(Math.ceil(totalChapters / 3) - scripts.length, 0),
    fullyUsedEpisodes: scripts.length,
    partialUsedEpisodes: 0
  }
}

function readStoredNotes(projectPath: string): string {
  return getStoredFiles()[buildNotesPath(projectPath)] || ''
}

function buildAdaptStatus(project: Project): { novelInfo: NovelInfo | null; waterLevel: WaterLevel; state: AdaptState } {
  const novelInfo = getNovelInfo(project)
  const waterLevel = buildWaterLevel(project)
  return {
    novelInfo,
    waterLevel,
    state: novelInfo ? 'breakdown_done' : 'adapt_idle'
  }
}

function getProjectFiles(projectPath: string): VirtualFileMap {
  const normalized = `${normalizeProjectPath(projectPath)}/`
  return Object.fromEntries(
    Object.entries(getStoredFiles()).filter(([path]) => path.startsWith(normalized))
  )
}

function remapBundleFiles(
  files: VirtualFileMap,
  fromProjectPath: string,
  toProjectPath: string
): VirtualFileMap {
  const fromBase = normalizeProjectPath(fromProjectPath)
  const toBase = normalizeProjectPath(toProjectPath)
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => {
      if (!path.startsWith(fromBase)) return [path, content]
      return [path.replace(fromBase, toBase), content]
    })
  )
}

function importVirtualBundle(bundle: WebProjectBundle): Project {
  const now = new Date().toISOString()
  const nextProjectId = generateId('project')
  const nextProjectPath = buildVirtualProjectPath(nextProjectId)
  const sourceProject = bundle.project
  const importedProject: Project = {
    ...sourceProject,
    id: nextProjectId,
    name: `${sourceProject.name}（导入）`,
    projectPath: nextProjectPath,
    createdAt: now,
    updatedAt: now,
    config: {
      ...sourceProject.config,
      projectName: `${sourceProject.name}（导入）`,
      createdAt: sourceProject.config.createdAt || now
    }
  }

  const projects = getStoredProjects()
  setStoredProjects([importedProject, ...projects])

  const files = getStoredFiles()
  const remappedFiles = remapBundleFiles(bundle.files || {}, sourceProject.projectPath, importedProject.projectPath)
  setStoredFiles({ ...files, ...remappedFiles })

  return importedProject
}

function createDefaultProjectConfig(input: {
  name: string
  sourceType?: ProjectSourceType
  phase?: ProjectPhase
  visualStyle: string
  targetMedium: string
  totalEpisodes: number
  novelTitle?: string
  novelGenre?: string
  config?: Record<string, unknown>
}): ProjectConfig {
  const rawConfig = (input.config || {}) as Partial<ProjectConfig>
  return {
    projectName: input.name,
    sourceType: input.sourceType || 'script',
    phase: input.phase || 'writing',
    totalEpisodes: input.totalEpisodes,
    visualStyle: input.visualStyle,
    targetMedium: input.targetMedium,
    workingDirectory: typeof rawConfig.workingDirectory === 'string' ? rawConfig.workingDirectory : undefined,
    novelTitle: input.novelTitle,
    novelGenre: input.novelGenre,
    originalContent: rawConfig.originalContent,
    createdAt: rawConfig.createdAt || new Date().toISOString(),
    ...rawConfig
  }
}

function buildWebDeliveryStatus(version: string): AppDeliveryStatus {
  const llmConfigs = getStoredLLMConfigs()
  const projects = getStoredProjects()
  const defaultLLMCount = llmConfigs.filter((config) => config.isDefault).length
  const issues: AppDeliveryIssue[] = []

  if (llmConfigs.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'WEB_NO_LLM_CONFIG',
      message: '当前是网页预览模式，尚未配置模型。可先在设置页保存 LLM 配置。'
    })
  }

  issues.push({
    severity: 'info',
    code: 'WEB_PREVIEW_LIMITED',
    message: '当前运行于浏览器模式。基础项目、剧本编辑和设置可在浏览器内使用；文件选择器、小说导入和后台流水线仍需桌面端或服务端支持。'
  })

  return {
    generatedAt: new Date().toISOString(),
    version,
    packaged: false,
    platform: 'web',
    arch: 'browser',
    paths: {
      userData: 'browser://localStorage',
      database: 'browser://localStorage',
      logsDir: 'browser://console',
      runtimeLog: 'browser://console',
      reportsDir: 'browser://download'
    },
    readiness: {
      score: llmConfigs.length > 0 ? 68 : 42,
      issueCount: issues.filter((issue) => issue.severity === 'error').length,
      warningCount: issues.filter((issue) => issue.severity === 'warning').length,
      llmConfigCount: llmConfigs.length,
      defaultLLMCount,
      projectCount: projects.length,
      readyForDelivery: false
    },
    runtime: {
      openWindowCount: 1,
      queuedRunCount: 0,
      deadLetterCount: 0,
      automationEnabledCount: 0,
      telemetryCallCount: 0
    },
    recentErrors: [],
    issues
  }
}

function triggerJSONDownload(filename: string, payload: unknown): string {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return `browser-download:${filename}`
}

function triggerTextDownload(filename: string, content: string, mimeType = 'text/plain;charset=utf-8'): string {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return `browser-download:${filename}`
}

function exportVirtualPrompts(params: {
  projectPath: string
  projectName: string
  episodeRange: number[]
  format: 'markdown' | 'json' | 'csv'
}): { success: true; path: string; count: number } {
  const docs = listVirtualPromptDocs(params.projectPath, params.episodeRange)
  if (docs.length === 0) {
    return {
      success: true,
      path: triggerTextDownload(`${params.projectName}-prompts-empty.md`, '# 暂无提示词文件\n'),
      count: 0
    }
  }

  if (params.format === 'json') {
    return {
      success: true,
      path: triggerJSONDownload(`${params.projectName}-prompts.json`, docs),
      count: docs.length
    }
  }

  if (params.format === 'csv') {
    const csv = ['episode,filename,content']
      .concat(docs.map((doc) => `${doc.episode},"${doc.filename.replace(/"/g, '""')}","${doc.content.replace(/"/g, '""').replace(/\n/g, '\\n')}"`))
      .join('\n')
    return {
      success: true,
      path: triggerTextDownload(`${params.projectName}-prompts.csv`, csv, 'text/csv;charset=utf-8'),
      count: docs.length
    }
  }

  const markdown = docs.map((doc) => `# EP${String(doc.episode).padStart(3, '0')}\n\n${doc.content}`).join('\n\n---\n\n')
  return {
    success: true,
    path: triggerTextDownload(`${params.projectName}-prompts.md`, markdown, 'text/markdown;charset=utf-8'),
    count: docs.length
  }
}

function exportVirtualScripts(params: {
  projectPath: string
  projectName: string
  episodeRange: number[]
}): { success: true; path: string; count: number } {
  const allowed = new Set(params.episodeRange)
  const docs = listVirtualScriptDocs(params.projectPath).filter((doc) => allowed.has(doc.episode))
  const markdown = docs.length > 0
    ? docs.map((doc) => `# EP${String(doc.episode).padStart(3, '0')}\n\n${doc.content}`).join('\n\n---\n\n')
    : '# 暂无剧本文件\n'
  return {
    success: true,
    path: triggerTextDownload(`${params.projectName}-scripts.md`, markdown, 'text/markdown;charset=utf-8'),
    count: docs.length
  }
}

function exportVirtualBundle(params: { projectPath: string; projectName: string }): { success: true; path: string; count: number } {
  const scripts = listVirtualScriptDocs(params.projectPath)
  const prompts = listVirtualPromptDocs(params.projectPath)
  const project = getStoredProjects().find((item) => item.projectPath === params.projectPath) || null
  const bundle: WebProjectBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: project || {
      id: 'web-export',
      name: params.projectName,
      sourceType: 'script',
      phase: 'writing',
      visualStyle: '',
      targetMedium: '',
      projectPath: params.projectPath,
      totalEpisodes: Math.max(scripts.length, 1),
      config: {
        projectName: params.projectName,
        sourceType: 'script',
        phase: 'writing',
        totalEpisodes: Math.max(scripts.length, 1),
        visualStyle: '',
        targetMedium: '',
        createdAt: new Date().toISOString()
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    files: getProjectFiles(params.projectPath)
  }
  return {
    success: true,
    path: triggerJSONDownload(`${params.projectName}-bundle.json`, bundle),
    count: scripts.length + prompts.length
  }
}

function isBrowserFetchAllowed(baseUrl: string): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl, window.location.origin)
    return url.origin === window.location.origin
  } catch {
    return false
  }
}

async function testBrowserLLMConnection(config: LLMConfig): Promise<{ success: boolean; message: string }> {
  if (!isBrowserFetchAllowed(config.baseUrl)) {
    return {
      success: false,
      message: '网页预览模式不会把 API Key 直接发往第三方模型服务。请改用同源代理，或在桌面端测试连接。'
    }
  }

  try {
    let url = config.baseUrl.replace(/\/+$/, '')
    if ((config.provider === 'openai' || config.provider === 'openai-compatible') && !url.endsWith('/v1')) {
      url += '/v1'
    }
    const response = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` }
    })
    if (!response.ok) {
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` }
    }
    return { success: true, message: '连接成功（浏览器同源代理）' }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function listBrowserModels(baseUrl: string, apiKey: string, provider?: LLMProviderType): Promise<{
  success: boolean
  models: Array<{ id: string; name: string; owner: string }>
  message: string
}> {
  if (provider && provider !== 'openai' && provider !== 'openai-compatible') {
    return { success: false, models: [], message: `${provider} 暂不支持网页端自动拉取模型列表，请手动填写模型名。` }
  }
  if (!isBrowserFetchAllowed(baseUrl)) {
    return {
      success: false,
      models: [],
      message: '网页预览模式仅支持同源代理拉取模型列表。请配置同源代理，或在桌面端获取模型列表。'
    }
  }

  try {
    let url = baseUrl.replace(/\/+$/, '')
    if (!url.endsWith('/v1')) url += '/v1'
    const response = await fetch(`${url}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (!response.ok) {
      return { success: false, models: [], message: `HTTP ${response.status}: ${response.statusText}` }
    }
    const data = await response.json() as { data?: Array<{ id: string; display_name?: string; owned_by?: string }> }
    const models = (data.data || []).map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      owner: model.owned_by || ''
    }))
    return { success: true, models, message: `获取到 ${models.length} 个模型` }
  } catch (error) {
    return {
      success: false,
      models: [],
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function handleWebInvoke(channel: PlatformChannel, ...args: unknown[]): Promise<unknown> {
  switch (channel) {
    case IPC.APP_GET_VERSION:
      return '0.1.0-web-preview'
    case IPC.APP_GET_DELIVERY_STATUS:
      return buildWebDeliveryStatus('0.1.0-web-preview')
    case IPC.APP_EXPORT_DELIVERY_REPORT: {
      const status = buildWebDeliveryStatus('0.1.0-web-preview')
      const filePath = triggerJSONDownload(`feicai-delivery-report-${Date.now()}.json`, status)
      return { filePath, status }
    }
    case IPC.LLM_LIST_CONFIGS:
      return getStoredLLMConfigs()
    case IPC.LLM_ADD_CONFIG: {
      const data = args[0] as Omit<LLMConfig, 'id'>
      const configs = getStoredLLMConfigs()
      const nextConfig: LLMConfig = {
        ...data,
        id: generateId('llm')
      }
      const nextConfigs = data.isDefault
        ? configs
          .map((item) => item.category === data.category ? { ...item, isDefault: false } : item)
          .concat(nextConfig)
        : configs.concat(nextConfig)
      setStoredLLMConfigs(nextConfigs)
      return nextConfig
    }
    case IPC.LLM_UPDATE_CONFIG: {
      const [id, patch] = args as [string, Partial<LLMConfig>]
      const configs = getStoredLLMConfigs()
      const current = configs.find((item) => item.id === id)
      if (!current) {
        return { success: false, error: '配置不存在' }
      }
      const merged = { ...current, ...patch, id: current.id }
      const nextConfigs = configs.map((item) => {
        if (item.id === id) return merged
        if (merged.isDefault && item.category === merged.category) {
          return { ...item, isDefault: false }
        }
        return item
      })
      setStoredLLMConfigs(nextConfigs)
      return { success: true }
    }
    case IPC.LLM_DELETE_CONFIG: {
      const [id] = args as [string]
      const configs = getStoredLLMConfigs()
      setStoredLLMConfigs(configs.filter((item) => item.id !== id))
      return { success: true }
    }
    case IPC.LLM_SET_DEFAULT: {
      const [id] = args as [string]
      const configs = getStoredLLMConfigs()
      const target = configs.find((item) => item.id === id)
      if (!target) {
        return { success: false, error: '配置不存在' }
      }
      setStoredLLMConfigs(configs.map((item) => ({
        ...item,
        isDefault: item.id === id ? true : item.category === target.category ? false : item.isDefault
      })))
      return { success: true }
    }
    case IPC.LLM_TEST_CONNECTION:
      return testBrowserLLMConnection(args[0] as LLMConfig)
    case IPC.LLM_LIST_MODELS:
      return listBrowserModels(args[0] as string, args[1] as string, args[2] as LLMProviderType | undefined)
    case IPC.PROJECT_LIST:
      return getStoredProjects()
    case IPC.PROJECT_GET: {
      const [id] = args as [string]
      return getStoredProjects().find((project) => project.id === id) || null
    }
    case IPC.PROJECT_CREATE: {
      const [data] = args as [ {
        name: string
        sourceType?: ProjectSourceType
        phase?: ProjectPhase
        visualStyle: string
        targetMedium: string
        projectPath?: string
        totalEpisodes: number
        novelTitle?: string
        novelGenre?: string
        config?: Record<string, unknown>
      }]
      const now = new Date().toISOString()
      const projectId = generateId('project')
      const project: Project = {
        id: projectId,
        name: data.name,
        sourceType: data.sourceType || 'script',
        phase: data.phase || 'writing',
        visualStyle: data.visualStyle,
        targetMedium: data.targetMedium,
        projectPath: data.projectPath || buildVirtualProjectPath(projectId),
        totalEpisodes: data.totalEpisodes,
        novelTitle: data.novelTitle,
        novelGenre: data.novelGenre,
        config: createDefaultProjectConfig(data),
        createdAt: now,
        updatedAt: now
      }
      setStoredProjects([project, ...getStoredProjects()])
      return project
    }
    case IPC.PROJECT_DELETE: {
      const [id] = args as [string]
      const projects = getStoredProjects()
      const project = projects.find((item) => item.id === id)
      setStoredProjects(projects.filter((item) => item.id !== id))
      if (project) {
        const files = getStoredFiles()
        const nextFiles = Object.fromEntries(
          Object.entries(files).filter(([path]) => !path.startsWith(`${normalizeProjectPath(project.projectPath)}/`))
        )
        setStoredFiles(nextFiles)
      }
      return { success: true }
    }
    case IPC.PROJECT_UPDATE_PHASE: {
      const [id, phase] = args as [string, ProjectPhase]
      let updatedProject: Project | null = null
      const nextProjects = getStoredProjects().map((project) => {
        if (project.id !== id) return project
        updatedProject = {
          ...project,
          phase,
          updatedAt: new Date().toISOString(),
          config: {
            ...project.config,
            phase
          }
        }
        return updatedProject
      })
      setStoredProjects(nextProjects)
      return updatedProject
    }
    case IPC.PROJECT_SAVE_CONFIG: {
      const [projectPath, config] = args as [string, Record<string, unknown>]
      let updatedProject: Project | null = null
      const nextProjects = getStoredProjects().map((project) => {
        if (project.projectPath !== projectPath) return project
        const nextConfig = {
          ...project.config,
          ...(config as Partial<ProjectConfig>),
          projectName: typeof config.projectName === 'string' ? config.projectName : project.name
        }
        updatedProject = {
          ...project,
          name: typeof nextConfig.projectName === 'string' ? nextConfig.projectName : project.name,
          sourceType: (nextConfig.sourceType || project.sourceType) as ProjectSourceType,
          phase: (nextConfig.phase || project.phase) as ProjectPhase,
          visualStyle: typeof nextConfig.visualStyle === 'string' ? nextConfig.visualStyle : project.visualStyle,
          targetMedium: typeof nextConfig.targetMedium === 'string' ? nextConfig.targetMedium : project.targetMedium,
          totalEpisodes: typeof nextConfig.totalEpisodes === 'number' ? nextConfig.totalEpisodes : project.totalEpisodes,
          novelTitle: typeof nextConfig.novelTitle === 'string' ? nextConfig.novelTitle : project.novelTitle,
          novelGenre: typeof nextConfig.novelGenre === 'string' ? nextConfig.novelGenre : project.novelGenre,
          config: nextConfig,
          updatedAt: new Date().toISOString()
        }
        return updatedProject
      })
      setStoredProjects(nextProjects)
      return { success: true, project: updatedProject }
    }
    case IPC.PROJECT_IMPORT_BUNDLE:
      return importVirtualBundle(args[0] as WebProjectBundle)
    case IPC.PROJECT_READ_CONFIG:
      return null
    case IPC.PROJECT_GET_STATUS: {
      const [projectId] = args as [string]
      const project = getStoredProjects().find((item) => item.id === projectId)
      return project ? listVirtualEpisodes(project) : []
    }
    case IPC.PROJECT_SYNC_STATUS: {
      const [projectId] = args as [string, string]
      const project = getStoredProjects().find((item) => item.id === projectId)
      return project ? listVirtualEpisodes(project) : []
    }
    case IPC.SCRIPT_LIST_EPISODES: {
      const [projectPath] = args as [string]
      return listVirtualScriptDocs(projectPath)
    }
    case IPC.SCRIPT_READ_EPISODE: {
      const [projectPath, episodeNum] = args as [string, number]
      return getStoredFiles()[buildScriptPath(projectPath, episodeNum)] || null
    }
    case IPC.SCRIPT_SAVE_EPISODE: {
      const [projectPath, episodeNum, content] = args as [string, number, string]
      const files = getStoredFiles()
      files[buildScriptPath(projectPath, episodeNum)] = content
      setStoredFiles(files)
      return { success: true }
    }
    case IPC.ASSET_LIST_CHARACTERS: {
      const [projectPath] = args as [string]
      const project = getStoredProjects().find((item) => item.projectPath === projectPath)
      return project ? buildVirtualAssets(project).characters : []
    }
    case IPC.ASSET_LIST_SCENES: {
      const [projectPath] = args as [string]
      const project = getStoredProjects().find((item) => item.projectPath === projectPath)
      return project ? buildVirtualAssets(project).scenes : []
    }
    case IPC.ASSET_LOAD_PROMPTS: {
      const [projectPath, episodeNum] = args as [string, number]
      const raw = getStoredFiles()[buildPromptPath(projectPath, episodeNum, 'prompts')] || ''
      return parsePromptMarkdown(raw).map((item) => ({
        index: item.index,
        title: item.title,
        duration: item.duration,
        references: item.references
      }))
    }
    case IPC.ASSET_PROMPT_STATS: {
      const [projectPath, episodeNum] = args as [string, number]
      const prompts = parsePromptMarkdown(getStoredFiles()[buildPromptPath(projectPath, episodeNum, 'prompts')] || '')
      const totalCount = prompts.length
      const totalDuration = prompts.reduce((sum, prompt) => sum + prompt.duration, 0)
      return {
        totalCount,
        totalDuration,
        avgDuration: totalCount > 0 ? Number((totalDuration / totalCount).toFixed(1)) : 0
      }
    }
    case IPC.ASSET_UPLOAD_IMAGE:
      return { success: false, error: '浏览器模式暂不支持直接上传本地参考图。' }
    case IPC.ASSET_UPDATE_PROMPT: {
      const [payload] = args as [{
        projectPath: string
        assetType: 'character' | 'scene'
        assetName: string
        newPromptText: string
      }]
      const key = payload.assetName.startsWith('@') ? payload.assetName : `@${payload.assetName}`
      const files = getStoredFiles()
      const overridePath = buildAssetPromptPath(payload.projectPath, payload.assetType)
      const currentRaw = files[overridePath]
      let nextOverrides: Record<string, string> = {}
      if (currentRaw) {
        try {
          nextOverrides = JSON.parse(currentRaw) as Record<string, string>
        } catch {
          nextOverrides = {}
        }
      }
      nextOverrides[key] = payload.newPromptText
      files[overridePath] = JSON.stringify(nextOverrides, null, 2)
      setStoredFiles(files)
      return { success: true }
    }
    case IPC.PROMPT_READ_EPISODE_FILE: {
      const [projectPath, episodeNum, kind] = args as [string, number, string]
      return readPromptArtifact(projectPath, episodeNum, kind)
    }
    case IPC.PROMPT_SAVE_EPISODE_FILE: {
      const [projectPath, episodeNum, kind, content] = args as [string, number, string, string]
      const files = getStoredFiles()
      files[resolvePromptArtifactPath(projectPath, episodeNum, kind)] = content
      setStoredFiles(files)
      return { success: true }
    }
    case IPC.NOVEL_IMPORT: {
      const [payload] = args as [{ projectPath: string; chapters?: ImportedChapterPayload[]; sourcePath?: string }]
      if (!payload.projectPath) {
        throw new Error('projectPath is required')
      }
      if (!payload.chapters || payload.chapters.length === 0) {
        throw new Error('Web mode only supports importing chapters payloads')
      }
      const files = getStoredFiles()
      for (const chapter of payload.chapters) {
        files[buildNovelChapterPath(payload.projectPath, chapter.chapterNum)] = chapter.content
      }
      setStoredFiles(files)
      const project = getStoredProjects().find((item) => item.projectPath === payload.projectPath)
      if (project) {
        const derived = buildDerivedBreakdown(project)
        files[buildPlotBreakdownPath(payload.projectPath)] = derived.raw
        setStoredFiles(files)
      }
      return { imported: payload.chapters.length }
    }
    case IPC.NOVEL_SCAN: {
      const [novelDirPath] = args as [string]
      const projectPath = novelDirPath.replace(/\/novel$/, '')
      const chapters = listVirtualNovelDocs(projectPath)
      return {
        totalChapters: chapters.length,
        chapterRange: chapters.length > 0 ? [chapters[0].chapterNum, chapters[chapters.length - 1].chapterNum] : [0, 0],
        chapterFiles: chapters.map((chapter) => chapter.filename)
      }
    }
    case IPC.NOVEL_READ_CHAPTER: {
      const [projectPath, chapterNum] = args as [string, number]
      const content = getStoredFiles()[buildNovelChapterPath(projectPath, chapterNum)] || ''
      return content ? {
        chapterNum,
        title: `第${chapterNum}章`,
        content
      } : null
    }
    case IPC.PLOT_GET_BREAKDOWN: {
      const [projectPath] = args as [string]
      const project = getStoredProjects().find((item) => item.projectPath === projectPath)
      return project ? buildDerivedBreakdown(project).data : null
    }
    case IPC.PLOT_READ_RAW: {
      const [projectPath] = args as [string]
      return getStoredFiles()[buildPlotBreakdownPath(projectPath)] || null
    }
    case IPC.ADAPT_GET_STATUS: {
      const [{ projectPath }] = args as [{ projectPath: string }]
      const project = getStoredProjects().find((item) => item.projectPath === projectPath)
      if (!project) {
        return {
          novelInfo: null,
          waterLevel: buildWaterLevel({
            id: 'missing',
            name: 'missing',
            sourceType: 'novel',
            phase: 'writing',
            visualStyle: '',
            targetMedium: '',
            projectPath,
            totalEpisodes: 0,
            config: { projectName: 'missing', totalEpisodes: 0, visualStyle: '', targetMedium: '', createdAt: new Date().toISOString() },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }),
          state: 'adapt_idle'
        }
      }
      return buildAdaptStatus(project)
    }
    case IPC.ADAPT_INIT_PROJECT: {
      const [payload] = args as [{ novelTitle: string; novelGenre: string; projectPath: string }]
      let updatedProject: Project | null = null
      const nextProjects = getStoredProjects().map((project) => {
        if (project.projectPath !== payload.projectPath) return project
        updatedProject = {
          ...project,
          novelTitle: payload.novelTitle,
          novelGenre: payload.novelGenre,
          config: {
            ...project.config,
            novelTitle: payload.novelTitle,
            novelGenre: payload.novelGenre
          },
          updatedAt: new Date().toISOString()
        }
        return updatedProject
      })
      setStoredProjects(nextProjects)
      return { success: true, project: updatedProject }
    }
    case IPC.ADAPT_LOAD_PLAN: {
      const [projectPath] = args as [string]
      return readStoredPlan(projectPath)
    }
    case IPC.ADAPT_SAVE_PLAN: {
      const [payload] = args as [{ projectPath: string; plan: AdaptPlan }]
      const files = getStoredFiles()
      files[buildPlanPath(payload.projectPath)] = JSON.stringify(payload.plan)
      setStoredFiles(files)
      return { success: true }
    }
    case IPC.ADAPT_LOAD_NOTES: {
      const [projectPath] = args as [string]
      return readStoredNotes(projectPath)
    }
    case IPC.ADAPT_SAVE_NOTES: {
      const [payload] = args as [{ projectPath: string; notes: string }]
      const files = getStoredFiles()
      files[buildNotesPath(payload.projectPath)] = payload.notes
      setStoredFiles(files)
      return { success: true }
    }
    case IPC.EXPORT_PROMPTS:
      return exportVirtualPrompts(args[0] as {
        projectPath: string
        projectName: string
        episodeRange: number[]
        format: 'markdown' | 'json' | 'csv'
      })
    case IPC.EXPORT_SCRIPTS:
      return exportVirtualScripts(args[0] as {
        projectPath: string
        projectName: string
        episodeRange: number[]
      })
    case IPC.EXPORT_ALL:
      return exportVirtualBundle(args[0] as {
        projectPath: string
        projectName: string
      })
    case IPC.FILE_WRITE: {
      const [filePath, content] = args as [string, string]
      const filename = filePath.split('/').pop() || 'feicai-export.txt'
      return { success: true, path: triggerTextDownload(filename, content) }
    }
    case IPC.PIPELINE_LIST_ALL_RUNS:
    case IPC.PIPELINE_LIST_RUNS:
      return [] as PipelineRunRecord[]
    case IPC.PIPELINE_GET_DIAGNOSTICS:
      return {
        generatedAt: new Date().toISOString(),
        activeRun: null,
        queue: [],
        queueSummary: {
          total: 0,
          waitingForSchedule: 0,
          waitingForDependency: 0,
          deadLetter: 0
        },
        automation: {
          projectCount: 0,
          enabledScheduleCount: 0,
          lastScanAt: undefined,
          nextQueueWakeAt: undefined,
          lastScanError: undefined
        },
        recovery: {
          deadLetterCount: 0,
          lastSweepAt: undefined,
          orphanedRunCount: 0,
          lastSweepError: undefined
        },
        telemetry: {
          runCount: 0,
          callCount: 0,
          successCount: 0,
          failureCount: 0,
          totalDurationMs: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          lastCalledAt: undefined
        },
        issues: []
      } as PipelineRuntimeDiagnostics
    case IPC.PIPELINE_GET_RUN_DETAIL:
      return null
    default:
      throw createUnavailableError(channel)
  }
}

function createDesktopPlatformAPI(): PlatformAPI {
  const api = window.feicaiAPI
  if (!api) {
    return createWebPlatformAPI()
  }

  return {
    isDesktopBridgeAvailable: true,
    isWebPreview: false,
    capabilities: {
      desktopBridge: true,
      llmSettings: true,
      deliveryStatus: true,
      projectFilesystem: true,
      pipelineRuntime: true
    },
    invoke: (channel, ...args) => api.invoke(channel, ...args),
    on: (channel, callback) => api.on(channel, callback),
    once: (channel, callback) => api.once(channel, callback)
  }
}

function hasDesktopBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.feicaiAPI?.invoke === 'function'
}

async function invokeWebChannel(channel: PlatformChannel, ...args: unknown[]): Promise<unknown> {
  const config = getWebTransportConfig()
  if (config.mode === 'remote-http') {
    return invokeRemoteChannel(config, channel, args)
  }
  return handleWebInvoke(channel, ...args)
}

function subscribeWebChannel(channel: PlatformChannel, callback: PlatformListener): () => void {
  const config = getWebTransportConfig()
  if (config.mode === 'remote-http') {
    return subscribeRemoteChannel(config, channel, callback)
  }
  return () => {}
}

export const platformAPI: PlatformAPI = {
  get isDesktopBridgeAvailable() {
    return hasDesktopBridge()
  },
  get isWebPreview() {
    return !hasDesktopBridge()
  },
  get capabilities() {
    if (hasDesktopBridge()) {
      return {
        desktopBridge: true,
        llmSettings: true,
        deliveryStatus: true,
        projectFilesystem: true,
        pipelineRuntime: true
      }
    }
    const config = getWebTransportConfig()
    return {
      desktopBridge: false,
      llmSettings: true,
      deliveryStatus: true,
      projectFilesystem: true,
      pipelineRuntime: config.mode === 'remote-http'
    }
  },
  invoke: async (channel, ...args) => {
    if (hasDesktopBridge()) {
      return createDesktopPlatformAPI().invoke(channel, ...args)
    }
    return invokeWebChannel(channel, ...args)
  },
  on: (channel, callback) => {
    if (hasDesktopBridge()) {
      return createDesktopPlatformAPI().on(channel, callback)
    }
    return subscribeWebChannel(channel, callback)
  },
  once: (channel, callback) => {
    const unsubscribe = platformAPI.on(channel, (...args) => {
      unsubscribe()
      callback(...args)
    })
  }
}

export function isUnsupportedPlatformError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Web preview does not support channel:')
}

export function getPlatformUnsupportedMessage(fallback: string): string {
  if (platformAPI.isWebPreview) {
    return `${fallback}当前是网页预览模式，该能力需要桌面端桥接或服务端支持。`
  }
  return fallback
}
