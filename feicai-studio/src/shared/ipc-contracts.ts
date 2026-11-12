import type { BatchAPI } from './batch'
import type {
  PipelineControlTarget,
  PipelineRunIdentity,
  PipelineEventIdentity,
  PipelineStageControl,
  PipelineTaskControl,
  PipelineTaskSnapshot
} from './pipeline-task'
import type { DataManagementAPI } from './data-management'
import type {
  DetectedProjectInfo,
  LegacyNovelMigrationResult,
  ProjectReadyItem,
  ProjectRepairIssueParams
} from './project-detection'
import type {
  AutomatedPipelineStage,
  Character,
  Episode,
  LLMConfig,
  LLMProviderType,
  LogEntry,
  PipelineContext,
  PipelineState,
  Project,
  ProjectConfig,
  ProjectPipelineState,
  ReviewResult,
  Scene
} from './types'

export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface CreateProjectInput {
  name: string
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  config: Partial<ProjectConfig>
  sourceNovelFilePath?: string
}

export interface UpdateProjectInput {
  name?: string
  visualStyle?: string
  targetMedium?: string
  totalEpisodes?: number
  config?: Partial<ProjectConfig>
}

export interface SyncSingleEpisodeParams {
  projectId: string
  projectPath: string
  episodeNum: number
}

export interface SourceChapterItem {
  index: number
  title: string
  fileName: string
  filePath: string
}

export interface PlotBreakdownSummary {
  totalEntries: number
  usedEntries: number
  unusedEntries: number
  totalBatches: number
  readyEpisodeCount: number
  readyEpisodeNumbers: number[]
  usedEpisodeCount: number
  usedEpisodeNumbers: number[]
  chapterStart: number | null
  chapterEnd: number | null
  nextBatchNumber: number
  targetChapterLimit: number | null
  totalSourceChapters: number
  unprocessedChapterCount: number | null
  overflowChapterCount: number
  waterlineStatus: 'ready' | 'low' | 'empty' | 'done'
  nextActionLabel: string
  nextActionMode: 'script' | 'breakdown' | 'done'
  breakdownProgressPct: number
  scriptProgressPct: number
  remainingBatchCount: number
  nextChapterStart: number | null
  nextChapterEnd: number | null
  path: string
  exists: boolean
}

export interface LLMModelInfo {
  id: string
  name: string
  owner: string
}

export interface LLMModelListRequest {
  baseUrl: string
  apiKey?: string
  configId?: string
  provider?: LLMProviderType
}

export interface LLMConnectionTestResult {
  success: boolean
  message: string
  model?: string
}

export interface LLMModelListResult {
  success: boolean
  models: LLMModelInfo[]
  message: string
}

export interface BasicSuccessResult {
  success: boolean
}

export interface ExecutionStatus {
  busy: boolean
  phase: 'idle' | 'running' | 'paused' | 'stopping'
  owner?: 'batch' | 'pipeline' | 'workflow' | 'data' | 'other'
}

export interface ProjectRepairResult {
  success: boolean
  appliedActions: string[]
  message: string
  detected: DetectedProjectInfo
  dryRun: boolean
  plannedChanges: string[]
  readyItems: ProjectReadyItem[]
}

export interface PipelineStartParams {
  projectId: string
  projectPath: string
  episodeNum: number
  projectName: string
  visualStyle: string
  targetMedium: string
  startStage?: AutomatedPipelineStage
  singleStage?: boolean
}

export interface PipelineStartResult {
  identity?: PipelineRunIdentity
  success?: boolean
  message?: string
  error?: string
  state?: PipelineState
  stage?: AutomatedPipelineStage
}

export interface WorkflowActionParams {
  projectId?: string
  projectPath: string
  episodeNum: number
  batchNumber?: number
  projectName: string
  visualStyle: string
  targetMedium: string
  reviewFeedback?: string
}

export interface WorkflowActionResult {
  stage?: string
  success: boolean
  outputPath?: string
  review?: ReviewResult
  error?: string
}

export interface AssetUpdatePromptParams {
  projectPath: string
  assetType: 'character' | 'scene'
  assetName: string
  newPromptText: string
}

export interface ExportPromptsParams {
  projectPath: string
  projectName: string
  episodeRange: number[]
  format: 'markdown' | 'json' | 'csv'
}

export interface ExportAllArtifactsParams {
  projectPath: string
  projectName: string
}

export interface ExportResult {
  success?: boolean
  canceled?: boolean
  path?: string
  count?: number
  error?: string
}

export interface PipelineStateChangedEvent extends PipelineEventIdentity {
  oldState: PipelineState
  newState: PipelineState
  context: PipelineContext
}

export interface PipelineStreamEvent extends PipelineEventIdentity {
  stage: AutomatedPipelineStage
  chunk: string
  totalLength: number
}

export interface PipelineStageCompleteEvent extends PipelineEventIdentity {
  stage: AutomatedPipelineStage
  result: ReviewResult
}

export interface PipelineReviewResultEvent extends PipelineEventIdentity {
  stage: AutomatedPipelineStage
  result: ReviewResult
}

export interface PipelineErrorEvent extends PipelineEventIdentity {
  message: string
  error: string
}

export interface FeicaiAPI extends BatchAPI, DataManagementAPI {
  listProjects(): Promise<Project[]>
  getProject(id: string): Promise<Project | null>
  detectProjectDirectory(dirPath: string): Promise<DetectedProjectInfo>
  inspectProjectDirectory(projectPath: string): Promise<DetectedProjectInfo>
  createProject(data: CreateProjectInput): Promise<Project>
  updateProject(id: string, data: UpdateProjectInput): Promise<Project>
  deleteProject(id: string): Promise<BasicSuccessResult | void>
  listProjectEpisodes(projectId: string): Promise<Episode[]>
  syncProjectStatus(projectId: string, projectPath: string): Promise<Episode[]>
  syncSingleEpisodeStatus(
    params: SyncSingleEpisodeParams
  ): Promise<Episode | null>
  getProjectPipelineState(
    projectPath: string
  ): Promise<ProjectPipelineState | null>
  migrateLegacyNovelDirectory(
    projectPath: string
  ): Promise<LegacyNovelMigrationResult>
  repairProjectIssues(
    params: ProjectRepairIssueParams
  ): Promise<ProjectRepairResult>
  listSourceChapters(projectId: string): Promise<SourceChapterItem[]>
  getPlotBreakdownSummary(projectId: string): Promise<PlotBreakdownSummary>

  listLLMConfigs(): Promise<LLMConfig[]>
  addLLMConfig(data: Omit<LLMConfig, 'id'>): Promise<LLMConfig>
  updateLLMConfig(
    id: string,
    data: Partial<Omit<LLMConfig, 'id'>>
  ): Promise<BasicSuccessResult | void>
  deleteLLMConfig(id: string): Promise<BasicSuccessResult | void>
  setDefaultLLM(id: string): Promise<BasicSuccessResult | void>
  testLLMConnection(config: LLMConfig): Promise<LLMConnectionTestResult>
  listLLMModels(payload: LLMModelListRequest): Promise<LLMModelListResult>

  readTextFile(filePath: string): Promise<string | null>
  writeTextFile(
    filePath: string,
    content: string,
    expectedContent?: string | null
  ): Promise<(BasicSuccessResult & { error?: string }) | void>
  selectDirectory(): Promise<string | null>
  selectFile(filters?: FileDialogFilter[]): Promise<string | null>

  getExecutionStatus(): Promise<ExecutionStatus>

  startPipeline(params: PipelineStartParams): Promise<PipelineStartResult>
  runPipelineAndWait(params: PipelineStartParams): Promise<PipelineStartResult>
  pausePipeline(
    target?: PipelineControlTarget
  ): Promise<BasicSuccessResult | void>
  abortPipeline(
    target?: PipelineControlTarget
  ): Promise<BasicSuccessResult | void>
  resumePipeline(
    target?: PipelineControlTarget
  ): Promise<BasicSuccessResult | void>
  retryPipeline(
    input?: AutomatedPipelineStage | PipelineStageControl
  ): Promise<BasicSuccessResult | void>
  skipPipeline(
    input?: AutomatedPipelineStage | PipelineStageControl
  ): Promise<BasicSuccessResult | void>
  getPipelineState(target?: PipelineControlTarget): Promise<PipelineContext>
  listPipelineTasks(): Promise<PipelineTaskSnapshot[]>
  getPipelineTask(taskId: string): Promise<PipelineTaskSnapshot | null>
  controlPipelineTask(
    request: PipelineTaskControl
  ): Promise<BasicSuccessResult & { error?: string }>
  onPipelineTaskChanged(
    callback: (snapshot: PipelineTaskSnapshot) => void
  ): () => void

  runStoryGeneration(
    params: WorkflowActionParams
  ): Promise<WorkflowActionResult>
  runStoryReview(params: WorkflowActionParams): Promise<WorkflowActionResult>
  runScriptGeneration(
    params: WorkflowActionParams
  ): Promise<WorkflowActionResult>
  runScriptReview(params: WorkflowActionParams): Promise<WorkflowActionResult>
  runCharacterDesign(
    params: WorkflowActionParams
  ): Promise<WorkflowActionResult>
  runStoryboardReview(
    params: WorkflowActionParams
  ): Promise<WorkflowActionResult>

  listCharacters(projectPath: string): Promise<Character[]>
  listScenes(projectPath: string): Promise<Scene[]>
  updateAssetPrompt(
    params: AssetUpdatePromptParams
  ): Promise<BasicSuccessResult & { error?: string }>

  exportPrompts(params: ExportPromptsParams): Promise<ExportResult>
  exportAllArtifacts(params: ExportAllArtifactsParams): Promise<ExportResult>

  onPipelineStateChanged(
    callback: (payload: PipelineStateChangedEvent) => void
  ): () => void
  onPipelineLog(
    callback: (payload: LogEntry & PipelineEventIdentity) => void
  ): () => void
  onPipelineStream(callback: (payload: PipelineStreamEvent) => void): () => void
  onPipelineStageComplete(
    callback: (payload: PipelineStageCompleteEvent) => void
  ): () => void
  onPipelineReviewResult(
    callback: (payload: PipelineReviewResultEvent) => void
  ): () => void
  onPipelineError(callback: (payload: PipelineErrorEvent) => void): () => void
}
