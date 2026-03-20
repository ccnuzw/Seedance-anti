// ============================================================
// FEICAI Studio — 共享类型定义
// ============================================================

// ---------- Project ----------

export type ProjectSourceType = 'novel' | 'script' | 'original'
export type ProjectPhase = 'writing' | 'production'

export interface PipelineSettings {
  maxRetries: number          // 最大重试次数 (default: 3)
  passScore: number           // 审核通过阈值 (default: 7)
  llmTimeoutSec: number       // LLM 超时秒数 (default: 90)
  durationMin: number         // 每集最短时长秒 (default: 90)
  durationMax: number         // 每集最长时长秒 (default: 120)
  singlePromptMax: number     // 单条提示词最大秒数 (default: 10)
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  maxRetries: 3,
  passScore: 7,
  llmTimeoutSec: 90,
  durationMin: 90,
  durationMax: 120,
  singlePromptMax: 10
}

export interface ProjectConfig {
  projectName: string
  totalEpisodes: number
  visualStyle: string
  targetMedium: string
  createdAt: string
  pipelineSettings?: PipelineSettings
}

export interface Project {
  id: string
  name: string
  sourceType: ProjectSourceType
  phase: ProjectPhase
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  novelTitle?: string
  novelGenre?: string
  config: ProjectConfig
  createdAt: string
  updatedAt: string
}

// ---------- Episode ----------

export type EpisodeStatus = 'idle' | 'director' | 'art' | 'storyboard' | 'complete'

export interface Episode {
  id: string
  projectId: string
  episodeNumber: number
  title: string
  status: EpisodeStatus
  scriptPath?: string
  directorAnalysisPath?: string
  artDesignPath?: string
  seedancePromptsPath?: string
  hasScript: boolean
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
  totalDurationSeconds?: number
  totalPrompts?: number
  createdAt: string
  updatedAt: string
}

// ---------- Assets ----------

export interface Character {
  id: string
  projectId: string
  name: string
  alias?: string
  age?: string
  appearance?: string
  promptText: string
  referenceImagePath?: string
  firstEpisode: number
  isVariant: boolean
  variantOf?: string
  createdAt: string
}

export interface Scene {
  id: string
  projectId: string
  name: string
  timeOfDay?: string
  lighting?: string
  atmosphere?: string
  promptText: string
  referenceImagePath?: string
  gridSource?: string
  gridPosition?: number
  createdAt: string
}

export interface AssetReference {
  id: string
  episodeId: string
  promptIndex: number
  assetType: 'character' | 'scene'
  assetId: string
  referenceTag: string // e.g. '@图片1'
}

// ---------- Pipeline ----------

export type PipelineStage = 'director' | 'art' | 'storyboard'

export type PipelineState =
  | 'idle'
  | 'script_loaded'
  | 'director_analyzing'
  | 'director_reviewing'
  | 'director_done'
  | 'art_designing'
  | 'art_reviewing'
  | 'art_done'
  | 'storyboard_writing'
  | 'storyboard_reviewing'
  | 'episode_complete'
  | 'paused'
  | 'error'

export interface PipelineContext {
  projectId: string
  projectPath: string
  episodeNum: number
  currentStage: PipelineStage
  state: PipelineState
  retryCount: number

  // 执行产物路径
  scriptPath?: string
  directorAnalysisPath?: string
  seedancePromptsPath?: string

  // 审核结果
  reviews: ReviewResult[]

  // 执行日志
  logs: LogEntry[]

  // 上次审核反馈（重试时传入 prompt）
  lastReviewFeedback?: string

  // 错误信息
  error?: string
}

export interface PipelineEvent {
  type: 'state_changed' | 'log' | 'stream' | 'stage_complete' | 'review_result' | 'error'
  timestamp: string
  data: unknown
}

// ---------- Skills ----------

export interface Skill {
  name: string
  description: string
  systemPrompt: string
  methodology?: string
  templates: Record<string, string>
  examples: Record<string, string>
  guides?: Record<string, string>
  skillPath: string
  fileManifest: string[]
}

// ---------- Reviews ----------

export type ReviewType = 'business' | 'compliance'
export type ReviewResultStatus = 'PASS' | 'FAIL'

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor'
  description: string
  location?: string
  suggestion?: string
}

export interface ReviewResult {
  stage: PipelineStage
  reviewType: ReviewType
  result: ReviewResultStatus
  /** 便捷属性：result === 'PASS' */
  passed: boolean
  score: number
  feedback: string
  issues: ReviewIssue[]
  createdAt: string
}

// ---------- LLM ----------

export type ModelCategory = 'llm' | 'image' | 'video'

export type LLMProviderType = 'google' | 'anthropic' | 'openai' | 'openai-compatible'

export interface LLMConfig {
  id: string
  name: string
  category: ModelCategory
  provider: LLMProviderType
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
  isDefault: boolean
}

export interface AssembledPrompt {
  system: string
  user: string
}

export interface GenerateOptions {
  maxTokens?: number
  temperature?: number
  onChunk?: (chunk: string) => void
}

// ---------- Logs ----------

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  id: string
  episodeId: string
  stage: PipelineStage | AdaptStage
  level: LogLevel
  eventType: string
  message: string
  timestamp: string
  details?: Record<string, unknown>
}

// ---------- 编剧管线（网文改编 · xiaoshuo-jqjb） ----------

export type AdaptStage = 'breakdown' | 'script'

export type AdaptState =
  | 'adapt_idle'
  | 'novel_loaded'
  | 'breakdown_executing'
  | 'breakdown_reviewing'
  | 'breakdown_done'
  | 'script_executing'
  | 'script_reviewing'
  | 'script_done'
  | 'adapt_paused'
  | 'adapt_error'

export interface WaterLevel {
  unusedPlots: number
  unprocessedChapters: number
  completedEpisodes: number
  totalPlots: number
  totalChapters: number
  processedChapters: number
}

export interface AdaptContext {
  projectId: string
  projectPath: string
  currentStage: AdaptStage
  state: AdaptState
  retryCount: number

  // 拆解相关
  currentBatch: number
  chaptersPerBatch: number
  totalChapters: number
  processedChapters: number

  // 剧本创作相关
  currentScriptBatch: number

  // 资源水位
  waterLevel: WaterLevel

  // 执行日志
  reviews: ReviewResult[]
  logs: LogEntry[]
  error?: string
  lastReviewFeedback?: string

  // 改编规划
  adaptPlan?: AdaptPlan
}

export interface NovelInfo {
  title: string
  genre: string
  totalChapters: number
  chaptersDir: string
}

export interface PlotPoint {
  id: number
  scene: string
  description: string
  hookType: string
  episode: number
  status: 'unused' | 'used'
  batch: number
}

export interface AdaptSettings {
  chaptersPerBatch: number
  maxEpisodesPerBatch: number
  breakdownMaxRetries: number
  scriptMaxRetries: number
  breakdownPassScore: number
  scriptPassScore: number
}

export const DEFAULT_ADAPT_SETTINGS: AdaptSettings = {
  chaptersPerBatch: 6,
  maxEpisodesPerBatch: 4,
  breakdownMaxRetries: 3,
  scriptMaxRetries: 3,
  breakdownPassScore: 7,
  scriptPassScore: 7
}

/** 小说类型列表 */
export const NOVEL_GENRES = [
  '玄幻', '武侠', '都市', '言情', '古言',
  '悬疑', '推理', '科幻', '末世', '重生', '穿越'
] as const

export type NovelGenre = (typeof NOVEL_GENRES)[number]

// ---------- 改编规划（多卷支持） ----------

/** 单卷规划 */
export interface VolumePlan {
  volumeIndex: number                   // 卷序号（从0开始）
  volumeLabel: string                   // 卷标签，如 "第一卷"
  chapterRange: [number, number]        // 章节范围 [1, 201]
  targetEpisodes: number                // 目标集数
  episodeWordCount: [number, number]    // 单集字数范围
  plotsPerEpisode: [number, number]     // 每集剧情点数
  scenesPerEpisode: [number, number]    // 每集场景数
  seedancePerEpisode: [number, number]  // 每集 Seedance 段数
  chapterAllocation: string             // 章集分配原则
  additionalNotes: string               // 其他前置要求
  llmPlan: string                       // LLM 生成的规划全文（Markdown，可编辑）
}

/** 改编规划（多卷） */
export interface AdaptPlan {
  volumes: VolumePlan[]
  activeVolumeIndex: number             // 当前活跃卷
  createdAt: string
  updatedAt: string
}

/** 创建默认卷规划 */
export function createDefaultVolumePlan(index: number, totalChapters: number): VolumePlan {
  return {
    volumeIndex: index,
    volumeLabel: `第${index + 1}卷`,
    chapterRange: [1, Math.min(200, totalChapters)],
    targetEpisodes: 30,
    episodeWordCount: [1500, 2000],
    plotsPerEpisode: [3, 4],
    scenesPerEpisode: [3, 4],
    seedancePerEpisode: [9, 12],
    chapterAllocation: '约6-7章/集，核心爆点可独立成集，过渡章节压缩合并',
    additionalNotes: '',
    llmPlan: ''
  }
}
