// ============================================================
// FEICAI Studio — 共享类型定义
// ============================================================

// ---------- Project ----------

export interface PipelineSettings {
  maxRetries: number // 最大重试次数 (default: 3)
  passScore: number // 审核通过阈值 (default: 7)
  llmTimeoutSec: number // LLM 超时秒数 (default: 90)
  durationMin: number // 每集最短时长秒 (default: 90)
  durationMax: number // 每集最长时长秒 (default: 120)
  singlePromptMax: number // 单条提示词最大秒数 (default: 10)
  scriptWordCountMin: number // 每集剧本最少字数 (default: 1500)
  scriptWordCountMax: number // 每集剧本最多字数 (default: 2000)
}

export const DEFAULT_PIPELINE_SETTINGS: PipelineSettings = {
  maxRetries: 3,
  passScore: 7,
  llmTimeoutSec: 90,
  durationMin: 90,
  durationMax: 120,
  singlePromptMax: 10,
  scriptWordCountMin: 1500,
  scriptWordCountMax: 2000
}

export type ProjectWorkflowVersion = 1 | 2
export type ProjectEntryStage = 'novel' | 'story' | 'script'
export type ProjectWorkflowMode =
  | 'legacy_shortdrama'
  | 'novel_to_shortdrama'
  | 'story_to_shortdrama'
  | 'script_to_shortdrama'

export interface ProjectDirectories {
  sourceDir?: string
  storyDir?: string
  scriptDir?: string
  assetsDir?: string
  outputsDir?: string
  reviewsDir?: string
}

export interface ProjectConfig {
  projectName: string
  totalEpisodes: number
  visualStyle: string
  targetMedium: string
  chaptersPerEpisode?: number
  createdAt: string
  workflowVersion?: ProjectWorkflowVersion
  entryStage?: ProjectEntryStage
  workflowMode?: ProjectWorkflowMode
  directories?: ProjectDirectories
  pipelineSettings?: Partial<PipelineSettings>
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

export type WorkflowStageId =
  | 'novel'
  | 'story'
  | 'story_review'
  | 'script'
  | 'script_review'
  | 'script_approved'
  | 'director'
  | 'character'
  | 'art'
  | 'storyboard'
  | 'storyboard_review'
  | 'complete'

export type EpisodeStatus = 'idle' | WorkflowStageId

export interface Episode {
  id: string
  projectId: string
  episodeNumber: number
  title: string
  status: EpisodeStatus
  storyBeatPath?: string
  storyReviewPath?: string
  scriptPath?: string
  scriptReviewPath?: string
  directorAnalysisPath?: string
  characterDesignPath?: string
  artDesignPath?: string
  storyboardPath?: string
  seedancePromptsPath?: string
  storyboardReviewPath?: string
  hasStoryBeat: boolean
  hasStoryReview: boolean
  hasScript: boolean
  hasScriptReview: boolean
  hasDirectorAnalysis: boolean
  hasCharacterDesign: boolean
  hasArtDesign: boolean
  hasStoryboard: boolean
  hasSeedancePrompts: boolean
  hasStoryboardReview: boolean
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

export type PipelineStage =
  | 'story'
  | 'story_review'
  | 'script'
  | 'script_review'
  | 'director'
  | 'character'
  | 'art'
  | 'storyboard'
  | 'storyboard_review'

export type AutomatedPipelineStage = 'director' | 'art' | 'storyboard'

export type PipelineState =
  | 'idle'
  | 'story_generating'
  | 'story_done'
  | 'story_reviewing'
  | 'script_generating'
  | 'script_done'
  | 'script_reviewing'
  | 'script_approved'
  | 'director_analyzing'
  | 'director_reviewing'
  | 'director_done'
  | 'character_designing'
  | 'character_done'
  | 'art_designing'
  | 'art_reviewing'
  | 'art_done'
  | 'storyboard_writing'
  | 'storyboard_done'
  | 'storyboard_reviewing'
  | 'episode_complete'
  | 'paused'
  | 'error'

export interface PipelineContext {
  projectId: string
  projectPath: string
  episodeNum: number
  currentStage: AutomatedPipelineStage
  state: PipelineState
  retryCount: number
  singleStage?: boolean

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
  type:
    | 'state_changed'
    | 'log'
    | 'stream'
    | 'stage_complete'
    | 'review_result'
    | 'error'
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
export type ReviewStage =
  | 'story_review'
  | 'script_review'
  | 'director'
  | 'art'
  | 'storyboard_review'

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor'
  description: string
  location?: string
  suggestion?: string
}

export interface ReviewResult {
  stage: ReviewStage
  reviewType: ReviewType
  result: ReviewResultStatus
  /** 便捷属性：result === 'PASS' */
  passed: boolean
  score: number
  feedback: string
  issues: ReviewIssue[]
  createdAt: string
}

export type EpisodeWorkflowStageStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'

export interface EpisodeStageSnapshot {
  stage: PipelineStage
  status: EpisodeWorkflowStageStatus
  attempts: number
  startedAt?: string
  completedAt?: string
  updatedAt: string
  outputPath?: string
  reviewPath?: string
  lastError?: string
  lastReview?: ReviewResult
}

export interface EpisodePipelineState {
  episodeNum: number
  status: EpisodeStatus
  lastStage: PipelineStage
  completedStages: PipelineStage[]
  stageStates: Partial<Record<PipelineStage, EpisodeStageSnapshot>>
  reviews: ReviewResult[]
  totalDurationSeconds: number
  updatedAt: string
}

export interface ProjectPipelineState {
  projectId: string
  episodes: Record<number, EpisodePipelineState>
  updatedAt: string
}

// ---------- LLM ----------

export type ModelCategory = 'llm' | 'image' | 'video'

export type LLMProviderType =
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
export type OpenAIWireApi = 'chat-completions' | 'responses'
export type OpenAIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh'
export type OpenAIImageSize = 'auto' | '1024x1024' | '1024x1536' | '1536x1024'
export type OpenAIImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type OpenAIImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type OpenAIImageBackground = 'auto' | 'transparent' | 'opaque'

export interface LLMConfig {
  id: string
  name: string
  category: ModelCategory
  provider: LLMProviderType
  baseUrl: string
  apiKey: string
  hasStoredApiKey?: boolean
  apiKeyMasked?: string
  model: string
  wireApi?: OpenAIWireApi
  reasoningEffort?: OpenAIReasoningEffort
  imageSize?: OpenAIImageSize
  imageQuality?: OpenAIImageQuality
  imageOutputFormat?: OpenAIImageOutputFormat
  imageBackground?: OpenAIImageBackground
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
  stage: AutomatedPipelineStage
  level: LogLevel
  eventType: string
  message: string
  timestamp: string
  details?: Record<string, unknown>
}
