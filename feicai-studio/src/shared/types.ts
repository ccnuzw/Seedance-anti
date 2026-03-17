// ============================================================
// FEICAI Studio — 共享类型定义
// ============================================================

// ---------- Project ----------

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
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
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
  stage: PipelineStage
  level: LogLevel
  eventType: string
  message: string
  timestamp: string
  details?: Record<string, unknown>
}
