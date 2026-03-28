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

export interface EpisodeOutlineItem {
  episodeNumber: number
  title: string
  summary: string
}

export interface OriginalContentMetadata {
  title?: string
  genre?: string
  author?: string
  sourcePath?: string
  contentPath?: string
  importedAt?: string
  contentFormat?: 'text' | 'chapters'
}

export interface ProjectConfig {
  projectName: string
  sourceType?: ProjectSourceType
  phase?: ProjectPhase
  templateProfileId?: string
  exportProfileId?: string
  totalEpisodes: number
  visualStyle: string
  targetMedium: string
  workingDirectory?: string
  novelTitle?: string
  novelGenre?: string
  originalContent?: OriginalContentMetadata
  episodeOutlines?: EpisodeOutlineItem[]
  createdAt: string
  pipelineSettings?: PipelineSettings
  /** 小说→改编管线（Adapt）的项目级参数 */
  adaptSettings?: AdaptSettings
  /** 通用质检策略（Adapt + Seedance 流水线共享） */
  reviewPolicy?: ReviewPolicyConfig
  /** 项目级流程开关与流转策略 */
  flowConfig?: FlowConfig
  /** 项目级任务默认策略与编排偏好 */
  taskDefaults?: ProjectTaskDefaults
  /** 项目级任务模板 */
  taskTemplates?: ProjectTaskTemplate[]
  /** 项目级自动化计划 */
  taskSchedules?: ProjectTaskSchedule[]
  /** 项目级自动化告警 */
  taskAlerts?: ProjectTaskAlertConfig
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
export type ProjectEpisodeStageState = 'pending' | 'running' | 'completed' | 'failed'

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

export interface ProjectProgressEpisode {
  episodeNumber: number
  title: string
  status: EpisodeStatus
  statusLabel: string
  stageState?: ProjectEpisodeStageState
  stageStateLabel?: string
  currentPipelineState?: PipelineState
  lastError?: string
  scriptPath?: string
  directorAnalysisPath?: string
  artDesignPath?: string
  seedancePromptsPath?: string
  hasScript: boolean
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
  hasAssetUpdates: boolean
  assetUpdateKinds: Array<'character' | 'scene'>
  totalDurationSeconds?: number
  totalPrompts?: number
}

export interface ProjectProgressSummary {
  totalEpisodes: number
  counts: Record<EpisodeStatus, number>
  completedEpisodes: number
  startedEpisodes: number
  completionRate: number
}

export interface ProjectProgress {
  projectPath: string
  generatedAt: string
  episodes: ProjectProgressEpisode[]
  summary: ProjectProgressSummary
}

export interface ProjectCommandResult {
  command: string
  text: string
  progress?: ProjectProgress
  data?: Record<string, unknown>
}

export interface NovelContentDocument {
  projectPath: string
  contentPath: string
  content: string
  title?: string
  genre?: string
  sourcePath?: string
  importedAt?: string
  updatedAt: string
}

export interface EpisodeOutlineScene {
  id: string
  title: string
  summary: string
  beats?: string[]
  sourceChapters?: number[]
}

export interface EpisodeOutline {
  episodeNumber: number
  code: string
  title: string
  logline?: string
  summary: string
  sourceChapters: number[]
  scenes: EpisodeOutlineScene[]
  status: 'draft' | 'reviewed'
  updatedAt: string
}

export interface ScriptVersionSummary {
  artifactId: string
  version: number
  createdAt: string
  createdBy: ArtifactRecord['createdBy']
  filePath: string
  snapshotPath: string
  isCurrent: boolean
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

// ---------- Artifacts ----------

export type ArtifactKind =
  | 'project_config'
  | 'plot_breakdown'
  | 'adapt_plan'
  | 'adapt_notes'
  | 'script_episode'
  | 'director_output'
  | 'art_output'
  | 'seedance_prompts'
  | 'character_prompts'
  | 'scene_prompts'
  | 'pipeline_state'

export interface ArtifactRecord {
  id: string
  projectPath: string
  kind: ArtifactKind
  label: string
  scopeKey: string
  filePath: string
  snapshotPath: string
  episodeNum?: number
  stage?: PipelineStage | AdaptStage
  sourceRunId?: string
  createdBy: 'system' | 'user' | 'rollback'
  version: number
  contentType: string
  sizeBytes: number
  hash: string
  isCurrent: boolean
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface ArtifactManifest {
  version: number
  projectPath: string
  artifacts: ArtifactRecord[]
  updatedAt: string
}

export interface ArtifactQuery {
  projectPath: string
  episodeNum?: number
  kind?: ArtifactKind
  currentOnly?: boolean
}

export interface ArtifactRollbackParams {
  projectPath: string
  artifactId: string
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
  runId: string
  projectId: string
  projectPath: string
  episodeNum: number
  currentStage: PipelineStage
  state: PipelineState
  singleStage?: boolean
  retryCount: number
  runStartedAt?: string
  runEndedAt?: string
  lastUpdatedAt?: string

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

export type PipelineRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'dead_letter'
export type PipelineRunPriority = 'high' | 'normal' | 'low'
export type PipelineDependencyCondition = 'always' | 'on_success' | 'on_failure'
export type PipelineBatchMode = 'independent' | 'sequential_on_success' | 'sequential_always'
export type PipelineScheduleFrequency = 'once' | 'daily'

export interface PipelineTaskStrategy {
  batchId?: string
  batchLabel?: string
  priority: PipelineRunPriority
  maxAutoRetries: number
  attempt: number
  rootRunId: string
  templateId?: string
  templateLabel?: string
}

export interface PipelineTaskOrchestration {
  dependsOnRootRunId?: string
  condition: PipelineDependencyCondition
  scheduledAt?: string
  scheduleId?: string
  scheduleLabel?: string
  automationKey?: string
}

export interface PipelineRunRecord {
  runId: string
  projectId: string
  projectName?: string
  projectPath: string
  episodeNum: number
  currentStage: PipelineStage
  status: PipelineRunStatus
  state: PipelineState
  singleStage: boolean
  queuedAt: string
  startedAt?: string
  endedAt?: string
  lastUpdatedAt: string
  queuePosition?: number
  errorMessage?: string
  batchId?: string
  batchLabel?: string
  priority: PipelineRunPriority
  maxAutoRetries: number
  attempt: number
  rootRunId: string
  workerSlot?: number
  archivedAt?: string
  deadLetteredAt?: string
  recoveryNote?: string
  dependsOnRootRunId?: string
  triggerCondition: PipelineDependencyCondition
  scheduledAt?: string
  templateId?: string
  templateLabel?: string
  scheduleId?: string
  scheduleLabel?: string
  automationKey?: string
  telemetry?: PipelineRunTelemetrySummary
}

export interface PipelineRunDetail {
  run: PipelineRunRecord
  logs: LogEntry[]
  llmCalls: PipelineLLMCallRecord[]
}

export type PipelineAlertType = 'run_failed' | 'schedule_triggered'

export interface PipelineAutomationAlert {
  type: PipelineAlertType
  projectId: string
  projectPath: string
  projectName: string
  title: string
  message: string
  runId?: string
  rootRunId?: string
  scheduleId?: string
  scheduleLabel?: string
  templateId?: string
  templateLabel?: string
  toastNotifications: boolean
  desktopNotifications: boolean
  createdAt: string
}

export interface PipelineRuntimeDiagnostics {
  generatedAt: string
  activeRun: PipelineActiveSnapshot | null
  queue: PipelineQueueSnapshot[]
  queueSummary: {
    total: number
    waitingForSchedule: number
    waitingForDependency: number
    deadLetter: number
  }
  automation: {
    projectCount: number
    enabledScheduleCount: number
    lastScanAt?: string
    lastScanError?: string
    nextQueueWakeAt?: string
  }
  recovery: {
    deadLetterCount: number
    orphanedRunCount: number
    lastSweepAt?: string
    lastSweepError?: string
  }
  telemetry: PipelineRuntimeTelemetrySummary
  issues: PipelineRuntimeIssue[]
}

export interface PipelineActiveSnapshot {
  runId: string
  projectId: string
  projectPath: string
  episodeNum: number
  currentStage: PipelineStage
  state: PipelineState
  startedAt?: string
}

export interface PipelineQueueSnapshot {
  runId: string
  rootRunId: string
  projectId: string
  projectPath: string
  episodeNum: number
  currentStage: PipelineStage
  priority: PipelineRunPriority
  queuePosition?: number
  scheduledAt?: string
  dependsOnRootRunId?: string
  scheduleLabel?: string
  templateLabel?: string
}

export interface PipelineRuntimeIssue {
  severity: 'error' | 'warning'
  projectId: string
  projectName: string
  projectPath: string
  scope: 'template' | 'schedule' | 'alerts' | 'runtime' | 'recovery'
  field: string
  message: string
  id?: string
}

export interface AppDeliveryIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export interface AppDeliveryStatus {
  generatedAt: string
  version: string
  packaged: boolean
  platform: string
  arch: string
  paths: {
    userData: string
    database: string
    logsDir: string
    runtimeLog: string
    reportsDir: string
  }
  readiness: {
    score: number
    issueCount: number
    warningCount: number
    llmConfigCount: number
    defaultLLMCount: number
    projectCount: number
    readyForDelivery: boolean
  }
  runtime: {
    openWindowCount: number
    activeRunId?: string
    queuedRunCount: number
    deadLetterCount: number
    automationEnabledCount: number
    telemetryCallCount: number
  }
  recentErrors: Array<{
    timestamp: string
    scope: 'startup' | 'runtime'
    message: string
  }>
  issues: AppDeliveryIssue[]
}

export type LLMTelemetryTokenSource = 'actual' | 'estimated'
export type LLMCallStatus = 'success' | 'failed'
export type LLMFailureClass = 'timeout' | 'network' | 'rate_limit' | 'provider' | 'auth' | 'validation' | 'unknown'
export type PipelineLLMCallPhase = 'stage_execution' | 'business_review' | 'compliance_review'

export interface LLMUsageMetrics {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  tokenSource?: LLMTelemetryTokenSource
}

export interface PipelineLLMCallRecord {
  id: string
  runId: string
  stage: PipelineStage
  phase: PipelineLLMCallPhase
  provider: LLMProviderType | string
  model: string
  status: LLMCallStatus
  stream: boolean
  startedAt: string
  endedAt?: string
  durationMs: number
  usage?: LLMUsageMetrics
  estimatedCostUsd?: number
  failureClass?: LLMFailureClass
  errorMessage?: string
}

export interface PipelineRunTelemetrySummary {
  callCount: number
  successCount: number
  failureCount: number
  totalDurationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  lastProvider?: string
  lastModel?: string
  lastFailureClass?: LLMFailureClass
  lastCalledAt?: string
}

export interface PipelineRuntimeTelemetrySummary {
  runCount: number
  callCount: number
  successCount: number
  failureCount: number
  totalDurationMs: number
  totalTokens: number
  estimatedCostUsd: number
  lastCalledAt?: string
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
  stage: PipelineStage | AdaptStage
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
  signal?: AbortSignal
  onChunk?: (chunk: string) => void
  onTelemetry?: (metrics: {
    provider: LLMProviderType | string
    model: string
    usage?: LLMUsageMetrics
  }) => void
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
  | 'adapt_awaiting_user'
  | 'adapt_error'

export interface WaterLevel {
  unusedPlots: number
  unprocessedChapters: number
  completedEpisodes: number
  totalPlots: number
  totalChapters: number
  processedChapters: number
  assignedEpisodes: number
  scriptEpisodes: number
  pendingScriptEpisodes: number
  fullyUsedEpisodes: number
  partialUsedEpisodes: number
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

  // 用户笔记（注入到 prompt 中）
  userNotes?: string
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

export interface PlotBreakdown {
  title: string
  genre: string
  outlines: EpisodeOutline[]
  updatedAt: string
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

// ---------- 项目级 QA & 流程配置 ----------

export type QAMode = 'strict' | 'lenient' | 'report_only'

export interface ReviewPolicyConfig {
  /** QA 总模式：严格 / 宽松 / 仅报告 */
  qaMode: QAMode
  /** 可选：覆盖 Adapt 拆解阶段通过分数阈值 */
  adaptBreakdownPassScore?: number
  /** 可选：覆盖 Adapt 剧本阶段通过分数阈值 */
  adaptScriptPassScore?: number
  /** 每批拆解在首轮 FAIL 后，允许自动修正+重检的最大轮数（0 表示不做自动修正，默认 0） */
  breakdownAutoRepairRounds?: number
  /** 每批剧本在首轮 FAIL 后，允许自动修正+重检的最大轮数（0 表示不做自动修正，默认 0） */
  scriptAutoRepairRounds?: number
}

export interface FlowConfig {
  /** 是否执行小说→剧情拆解阶段 */
  enableAdaptBreakdown: boolean
  /** 是否执行小说→剧本创作阶段 */
  enableAdaptScript: boolean

  /** 是否在通过审核后自动流转到下一阶段（适用于 Seedance 流水线） */
  autoContinueOnPass: boolean
  /** 是否在首个严重 FAIL 时中止整个流程 */
  stopOnFirstFail: boolean

  /** 是否启用导演阶段（管线 2） */
  enableDirectorStage: boolean
  /** 是否启用服化道阶段（管线 2） */
  enableArtStage: boolean
  /** 是否启用分镜阶段（管线 2） */
  enableStoryboardStage: boolean
  /** 是否启用合规审核（所有阶段共享） */
  enableComplianceReview: boolean
}

export interface ProjectTaskDefaults {
  defaultPriority: PipelineRunPriority
  defaultMaxAutoRetries: number
  defaultBatchMode: PipelineBatchMode
  archiveAfterDays: number
}

export interface ProjectTaskTemplate {
  id: string
  label: string
  description?: string
  source?: 'builtin' | 'project'
  startStage?: PipelineStage
  singleStage?: boolean
  priority: PipelineRunPriority
  maxAutoRetries: number
  batchMode: PipelineBatchMode
}

export type ExportProfileAction = 'prompts' | 'scripts' | 'bundle'

export interface ExportProfilePreset {
  id: string
  label: string
  description: string
  action: ExportProfileAction
  format?: 'markdown' | 'json' | 'csv'
  rangeMode: 'all' | 'selected'
}

export interface ProjectAutomationPreset {
  id: string
  label: string
  description: string
  pipelineSettings?: Partial<PipelineSettings>
  reviewPolicy?: Partial<ReviewPolicyConfig>
  taskDefaults?: Partial<ProjectTaskDefaults>
  recommendedTemplateIds?: string[]
  defaultExportProfileId?: string
}

export interface ProjectTaskSchedule {
  id: string
  label: string
  enabled: boolean
  templateId?: string
  episodeNumbers: number[]
  frequency: PipelineScheduleFrequency
  timeValue: string
}

export interface ProjectTaskAlertConfig {
  notifyOnRunFailed: boolean
  notifyOnScheduleTriggered: boolean
  desktopNotifications: boolean
  toastNotifications: boolean
}

export const DEFAULT_REVIEW_POLICY: ReviewPolicyConfig = {
  qaMode: 'strict',
  breakdownAutoRepairRounds: 3,
  scriptAutoRepairRounds: 2,
}

export const DEFAULT_FLOW_CONFIG: FlowConfig = {
  enableAdaptBreakdown: true,
  enableAdaptScript: true,
  autoContinueOnPass: true,
  stopOnFirstFail: false,
  enableDirectorStage: true,
  enableArtStage: true,
  enableStoryboardStage: true,
  enableComplianceReview: true,
}

export const DEFAULT_PROJECT_TASK_DEFAULTS: ProjectTaskDefaults = {
  defaultPriority: 'normal',
  defaultMaxAutoRetries: 1,
  defaultBatchMode: 'independent',
  archiveAfterDays: 7
}

export const DEFAULT_PROJECT_TASK_ALERTS: ProjectTaskAlertConfig = {
  notifyOnRunFailed: true,
  notifyOnScheduleTriggered: true,
  desktopNotifications: true,
  toastNotifications: true
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
