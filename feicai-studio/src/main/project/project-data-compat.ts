import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, extname, join } from 'path'
import type {
  AdaptPlan,
  AdaptStage,
  ArtifactKind,
  ArtifactManifest,
  ArtifactRecord,
  EpisodeStatus,
  FlowConfig,
  PipelineContext,
  PipelineSettings,
  PipelineStage,
  PipelineState,
  ProjectConfig,
  ProjectPhase,
  ProjectSourceType,
  ProjectTaskAlertConfig,
  ProjectTaskDefaults,
  ProjectTaskSchedule,
  ProjectTaskTemplate,
  QAMode,
  ReviewIssue,
  ReviewPolicyConfig,
  ReviewResult,
  VolumePlan
} from '@shared/types'
import { createDefaultVolumePlan } from '@shared/types'

export const PROJECT_CONFIG_VERSION = 1
export const ADAPT_PLAN_VERSION = 1
export const PROJECT_STATE_VERSION = 2
export const ARTIFACT_MANIFEST_VERSION = 1
const PROJECT_DATA_REPORT_VERSION = 1

export type ProjectDataFileKind = 'projectConfig' | 'adaptPlan' | 'projectState' | 'artifactManifest'
export type ProjectDataMigrationStatus = 'unchanged' | 'migrated' | 'missing' | 'error'

export interface PersistedProjectConfig extends Omit<ProjectConfig, 'pipelineSettings' | 'adaptSettings' | 'reviewPolicy' | 'flowConfig' | 'taskDefaults'> {
  version: number
  sourceType?: ProjectSourceType
  phase?: ProjectPhase
  templateProfileId?: string
  exportProfileId?: string
  novelTitle?: string
  novelGenre?: string
  pipelineSettings?: Partial<PipelineSettings>
  adaptSettings?: Partial<import('@shared/types').AdaptSettings>
  reviewPolicy?: Partial<ReviewPolicyConfig>
  flowConfig?: Partial<FlowConfig>
  taskDefaults?: Partial<ProjectTaskDefaults>
  taskTemplates?: ProjectTaskTemplate[]
  taskSchedules?: ProjectTaskSchedule[]
  taskAlerts?: Partial<ProjectTaskAlertConfig>
}

export interface PersistedAdaptPlan extends AdaptPlan {
  version: number
}

interface PersistedEpisodeState {
  episodeNum: number
  status: EpisodeStatus
  lastStage: PipelineStage
  completedStages: PipelineStage[]
  reviews: ReviewResult[]
  totalDurationSeconds: number
  updatedAt: string
}

interface PersistedPipelineRuntimeSnapshot {
  context: PipelineContext
  status: 'running' | 'paused' | 'terminal'
  updatedAt: string
}

interface PersistedProjectStateLike {
  version: number
  projectId: string
  runtime?: PersistedPipelineRuntimeSnapshot
  episodes: Record<number, PersistedEpisodeState>
  updatedAt: string
}

export interface ProjectDataMigrationEntry {
  kind: ProjectDataFileKind
  relativePath: string
  existed: boolean
  status: ProjectDataMigrationStatus
  fromVersion: number | null
  toVersion: number
  backupPath?: string
  message?: string
}

export interface ProjectDataMigrationReport {
  version: number
  projectPath: string
  generatedAt: string
  summary: {
    checked: number
    migrated: number
    missing: number
    errors: number
  }
  entries: ProjectDataMigrationEntry[]
}

interface NormalizedFileResult<T> {
  data: T
  currentVersion: number
  fromVersion: number | null
  changed: boolean
}

const FILE_PATHS: Record<ProjectDataFileKind, string> = {
  projectConfig: 'project-config.json',
  adaptPlan: 'adapt-plan.json',
  projectState: join('outputs', 'pipeline-state.json'),
  artifactManifest: join('outputs', 'artifacts', 'manifest.json')
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as UnknownRecord
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized >= 0 ? normalized : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function compactObject<T extends UnknownRecord>(input: T): Partial<T> | undefined {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries) as Partial<T>
}

function asProjectSourceType(value: unknown): ProjectSourceType | undefined {
  return value === 'novel' || value === 'script' || value === 'original' ? value : undefined
}

function asProjectPhase(value: unknown): ProjectPhase | undefined {
  return value === 'writing' || value === 'production' ? value : undefined
}

function sanitizePipelineSettings(value: unknown): Partial<PipelineSettings> | undefined {
  const raw = asRecord(value)
  return compactObject({
    maxRetries: asNonNegativeInteger(raw.maxRetries),
    passScore: asFiniteNumber(raw.passScore),
    llmTimeoutSec: asNonNegativeInteger(raw.llmTimeoutSec),
    durationMin: asNonNegativeInteger(raw.durationMin),
    durationMax: asNonNegativeInteger(raw.durationMax),
    singlePromptMax: asNonNegativeInteger(raw.singlePromptMax)
  })
}

function sanitizeAdaptSettings(value: unknown): Partial<import('@shared/types').AdaptSettings> | undefined {
  const raw = asRecord(value)
  return compactObject({
    chaptersPerBatch: asNonNegativeInteger(raw.chaptersPerBatch),
    maxEpisodesPerBatch: asNonNegativeInteger(raw.maxEpisodesPerBatch),
    breakdownMaxRetries: asNonNegativeInteger(raw.breakdownMaxRetries),
    scriptMaxRetries: asNonNegativeInteger(raw.scriptMaxRetries),
    breakdownPassScore: asFiniteNumber(raw.breakdownPassScore),
    scriptPassScore: asFiniteNumber(raw.scriptPassScore)
  })
}

function sanitizeReviewPolicy(value: unknown): Partial<ReviewPolicyConfig> | undefined {
  const raw = asRecord(value)
  const qaMode: QAMode | undefined = raw.qaMode === 'strict' || raw.qaMode === 'lenient' || raw.qaMode === 'report_only'
    ? raw.qaMode
    : undefined

  return compactObject({
    qaMode,
    adaptBreakdownPassScore: asFiniteNumber(raw.adaptBreakdownPassScore),
    adaptScriptPassScore: asFiniteNumber(raw.adaptScriptPassScore),
    breakdownAutoRepairRounds: asNonNegativeInteger(raw.breakdownAutoRepairRounds),
    scriptAutoRepairRounds: asNonNegativeInteger(raw.scriptAutoRepairRounds)
  })
}

function sanitizeFlowConfig(value: unknown): Partial<FlowConfig> | undefined {
  const raw = asRecord(value)
  const asBoolean = (input: unknown): boolean | undefined => typeof input === 'boolean' ? input : undefined
  return compactObject({
    enableAdaptBreakdown: asBoolean(raw.enableAdaptBreakdown),
    enableAdaptScript: asBoolean(raw.enableAdaptScript),
    autoContinueOnPass: asBoolean(raw.autoContinueOnPass),
    stopOnFirstFail: asBoolean(raw.stopOnFirstFail),
    enableDirectorStage: asBoolean(raw.enableDirectorStage),
    enableArtStage: asBoolean(raw.enableArtStage),
    enableStoryboardStage: asBoolean(raw.enableStoryboardStage),
    enableComplianceReview: asBoolean(raw.enableComplianceReview)
  })
}

function sanitizeTaskDefaults(value: unknown): Partial<ProjectTaskDefaults> | undefined {
  const raw = asRecord(value)
  const priority = raw.defaultPriority === 'high' || raw.defaultPriority === 'normal' || raw.defaultPriority === 'low'
    ? raw.defaultPriority
    : undefined
  const batchMode = raw.defaultBatchMode === 'independent' ||
    raw.defaultBatchMode === 'sequential_on_success' ||
    raw.defaultBatchMode === 'sequential_always'
    ? raw.defaultBatchMode
    : undefined

  return compactObject({
    defaultPriority: priority,
    defaultMaxAutoRetries: asNonNegativeInteger(raw.defaultMaxAutoRetries),
    defaultBatchMode: batchMode,
    archiveAfterDays: asNonNegativeInteger(raw.archiveAfterDays)
  })
}

function sanitizeTaskTemplates(value: unknown): ProjectTaskTemplate[] | undefined {
  if (!Array.isArray(value)) return undefined
  const templates = value
    .map((item) => asRecord(item))
    .map((raw) => {
      const id = asString(raw.id)
      const label = asString(raw.label)
      if (!id || !label) return null
      const priority = raw.priority === 'high' || raw.priority === 'normal' || raw.priority === 'low'
        ? raw.priority
        : 'normal'
      const batchMode = raw.batchMode === 'independent' ||
        raw.batchMode === 'sequential_on_success' ||
        raw.batchMode === 'sequential_always'
        ? raw.batchMode
        : 'independent'
      const startStage = raw.startStage === 'director' || raw.startStage === 'art' || raw.startStage === 'storyboard'
        ? raw.startStage
        : undefined

      return {
        id,
        label,
        description: asString(raw.description),
        source: raw.source === 'builtin' || raw.source === 'project' ? raw.source : undefined,
        startStage,
        singleStage: typeof raw.singleStage === 'boolean' ? raw.singleStage : undefined,
        priority,
        maxAutoRetries: asNonNegativeInteger(raw.maxAutoRetries) ?? 0,
        batchMode
      } satisfies ProjectTaskTemplate
    })
    .filter((item): item is ProjectTaskTemplate => !!item)

  return templates.length > 0 ? templates : undefined
}

function sanitizeTaskSchedules(value: unknown): ProjectTaskSchedule[] | undefined {
  if (!Array.isArray(value)) return undefined
  const schedules = value
    .map((item) => asRecord(item))
    .map((raw) => {
      const id = asString(raw.id)
      const label = asString(raw.label)
      if (!id || !label) return null
      const frequency = raw.frequency === 'once' || raw.frequency === 'daily'
        ? raw.frequency
        : 'once'
      const timeValue = asString(raw.timeValue) || ''
      const episodeNumbers = Array.isArray(raw.episodeNumbers)
        ? raw.episodeNumbers
          .map((num) => asNonNegativeInteger(num))
          .filter((num): num is number => typeof num === 'number' && num > 0)
        : []

      return {
        id,
        label,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
        templateId: asString(raw.templateId),
        episodeNumbers,
        frequency,
        timeValue
      } satisfies ProjectTaskSchedule
    })
    .filter((item): item is ProjectTaskSchedule => !!item && item.timeValue.length > 0 && item.episodeNumbers.length > 0)

  return schedules.length > 0 ? schedules : undefined
}

function sanitizeTaskAlerts(value: unknown): Partial<ProjectTaskAlertConfig> | undefined {
  const raw = asRecord(value)
  const asBoolean = (input: unknown): boolean | undefined => typeof input === 'boolean' ? input : undefined
  return compactObject({
    notifyOnRunFailed: asBoolean(raw.notifyOnRunFailed),
    notifyOnScheduleTriggered: asBoolean(raw.notifyOnScheduleTriggered),
    desktopNotifications: asBoolean(raw.desktopNotifications),
    toastNotifications: asBoolean(raw.toastNotifications)
  })
}

function sanitizeEpisodeOutlines(value: unknown): import('@shared/types').EpisodeOutlineItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const outlines = value
    .map((item) => {
      const raw = asRecord(item)
      const episodeNumber = asNonNegativeInteger(raw.episodeNumber)
      const title = asString(raw.title) || ''
      const summary = asString(raw.summary) || ''
      if (!episodeNumber || (!title && !summary)) return null
      return { episodeNumber, title, summary } satisfies import('@shared/types').EpisodeOutlineItem
    })
    .filter((item): item is import('@shared/types').EpisodeOutlineItem => !!item)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)

  return outlines.length > 0 ? outlines : undefined
}

export function normalizeProjectConfigContent(input: unknown): PersistedProjectConfig {
  const raw = asRecord(input)
  const normalized: PersistedProjectConfig = {
    version: asNonNegativeInteger(raw.version) || PROJECT_CONFIG_VERSION,
    projectName: asString(raw.projectName) || '',
    totalEpisodes: asNonNegativeInteger(raw.totalEpisodes) || 0,
    visualStyle: asString(raw.visualStyle) || '',
    targetMedium: asString(raw.targetMedium) || '',
    createdAt: asString(raw.createdAt) || new Date().toISOString()
  }

  const sourceType = asProjectSourceType(raw.sourceType)
  const phase = asProjectPhase(raw.phase)
  const templateProfileId = asString(raw.templateProfileId)
  const exportProfileId = asString(raw.exportProfileId)
  const workingDirectory = asString(raw.workingDirectory)
  const novelTitle = asString(raw.novelTitle)
  const novelGenre = asString(raw.novelGenre)
  const originalContent = asRecord(raw.originalContent)
  const episodeOutlines = sanitizeEpisodeOutlines(raw.episodeOutlines)
  const pipelineSettings = sanitizePipelineSettings(raw.pipelineSettings)
  const adaptSettings = sanitizeAdaptSettings(raw.adaptSettings)
  const reviewPolicy = sanitizeReviewPolicy(raw.reviewPolicy)
  const flowConfig = sanitizeFlowConfig(raw.flowConfig)
  const taskDefaults = sanitizeTaskDefaults(raw.taskDefaults)
  const taskTemplates = sanitizeTaskTemplates(raw.taskTemplates)
  const taskSchedules = sanitizeTaskSchedules(raw.taskSchedules)
  const taskAlerts = sanitizeTaskAlerts(raw.taskAlerts)

  if (sourceType) normalized.sourceType = sourceType
  if (phase) normalized.phase = phase
  if (templateProfileId) normalized.templateProfileId = templateProfileId
  if (exportProfileId) normalized.exportProfileId = exportProfileId
  if (workingDirectory) normalized.workingDirectory = workingDirectory
  if (novelTitle) normalized.novelTitle = novelTitle
  if (novelGenre) normalized.novelGenre = novelGenre
  if (Object.keys(originalContent).length > 0) {
    normalized.originalContent = {
      title: asString(originalContent.title),
      genre: asString(originalContent.genre),
      author: asString(originalContent.author),
      sourcePath: asString(originalContent.sourcePath),
      contentPath: asString(originalContent.contentPath),
      importedAt: asString(originalContent.importedAt),
      contentFormat: originalContent.contentFormat === 'chapters' ? 'chapters' : 'text'
    }
  }
  if (episodeOutlines) normalized.episodeOutlines = episodeOutlines
  if (pipelineSettings) normalized.pipelineSettings = pipelineSettings
  if (adaptSettings) normalized.adaptSettings = adaptSettings
  if (reviewPolicy) normalized.reviewPolicy = reviewPolicy
  if (flowConfig) normalized.flowConfig = flowConfig
  if (taskDefaults) normalized.taskDefaults = taskDefaults
  if (taskTemplates) normalized.taskTemplates = taskTemplates
  if (taskSchedules) normalized.taskSchedules = taskSchedules
  if (taskAlerts) normalized.taskAlerts = taskAlerts

  return normalized
}

export function mergeProjectConfigContent(base: unknown, patch: unknown): PersistedProjectConfig {
  const baseRecord = asRecord(base)
  const patchRecord = asRecord(patch)
  return normalizeProjectConfigContent({
    ...baseRecord,
    ...patchRecord,
    pipelineSettings: {
      ...asRecord(baseRecord.pipelineSettings),
      ...asRecord(patchRecord.pipelineSettings)
    },
    adaptSettings: {
      ...asRecord(baseRecord.adaptSettings),
      ...asRecord(patchRecord.adaptSettings)
    },
    reviewPolicy: {
      ...asRecord(baseRecord.reviewPolicy),
      ...asRecord(patchRecord.reviewPolicy)
    },
    flowConfig: {
      ...asRecord(baseRecord.flowConfig),
      ...asRecord(patchRecord.flowConfig)
    },
    taskDefaults: {
      ...asRecord(baseRecord.taskDefaults),
      ...asRecord(patchRecord.taskDefaults)
    },
    taskAlerts: {
      ...asRecord(baseRecord.taskAlerts),
      ...asRecord(patchRecord.taskAlerts)
    },
    taskTemplates: Array.isArray(patchRecord.taskTemplates) ? patchRecord.taskTemplates : baseRecord.taskTemplates,
    taskSchedules: Array.isArray(patchRecord.taskSchedules) ? patchRecord.taskSchedules : baseRecord.taskSchedules
  })
}

function normalizeRange(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback
  const start = asNonNegativeInteger(value[0]) ?? fallback[0]
  const end = asNonNegativeInteger(value[1]) ?? fallback[1]
  return start <= end ? [start, end] : [end, start]
}

function inferChapterUpperBound(raw: UnknownRecord): number {
  const fromRootRange = Array.isArray(raw.chapterRange) ? asNonNegativeInteger(raw.chapterRange[1]) : undefined
  const totalChapters = asNonNegativeInteger(raw.totalChapters)
  const fromVolumes = Array.isArray(raw.volumes)
    ? raw.volumes.reduce((max, volume) => {
      const volumeRecord = asRecord(volume)
      const chapterRange = Array.isArray(volumeRecord.chapterRange) ? asNonNegativeInteger(volumeRecord.chapterRange[1]) : undefined
      return Math.max(max, chapterRange || 0)
    }, 0)
    : 0
  return Math.max(fromRootRange || 0, totalChapters || 0, fromVolumes, 200)
}

function normalizeVolumePlan(value: unknown, index: number, totalChapters: number): VolumePlan {
  const raw = asRecord(value)
  const fallback = createDefaultVolumePlan(index, totalChapters)
  return {
    volumeIndex: asNonNegativeInteger(raw.volumeIndex) ?? index,
    volumeLabel: asString(raw.volumeLabel) || fallback.volumeLabel,
    chapterRange: normalizeRange(raw.chapterRange, fallback.chapterRange),
    targetEpisodes: asNonNegativeInteger(raw.targetEpisodes) || fallback.targetEpisodes,
    episodeWordCount: normalizeRange(raw.episodeWordCount, fallback.episodeWordCount),
    plotsPerEpisode: normalizeRange(raw.plotsPerEpisode, fallback.plotsPerEpisode),
    scenesPerEpisode: normalizeRange(raw.scenesPerEpisode, fallback.scenesPerEpisode),
    seedancePerEpisode: normalizeRange(raw.seedancePerEpisode, fallback.seedancePerEpisode),
    chapterAllocation: asString(raw.chapterAllocation) || fallback.chapterAllocation,
    additionalNotes: asString(raw.additionalNotes) || '',
    llmPlan: asString(raw.llmPlan) || ''
  }
}

export function normalizeAdaptPlanContent(input: unknown): PersistedAdaptPlan {
  const raw = asRecord(input)
  const totalChapters = inferChapterUpperBound(raw)
  const rawVolumes = Array.isArray(raw.volumes) && raw.volumes.length > 0
    ? raw.volumes
    : [raw]
  const volumes = rawVolumes.map((volume, index) => normalizeVolumePlan(volume, index, totalChapters))
  const activeVolumeIndex = Math.min(
    Math.max(0, asNonNegativeInteger(raw.activeVolumeIndex) ?? 0),
    Math.max(0, volumes.length - 1)
  )

  return {
    version: asNonNegativeInteger(raw.version) || ADAPT_PLAN_VERSION,
    volumes,
    activeVolumeIndex,
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString()
  }
}

function normalizeReview(value: unknown): ReviewResult | null {
  const raw = asRecord(value)
  const stage = raw.stage === 'director' || raw.stage === 'art' || raw.stage === 'storyboard'
    || raw.stage === 'breakdown' || raw.stage === 'script'
    ? raw.stage
    : undefined
  const result = raw.result === 'PASS' || raw.result === 'FAIL'
    ? raw.result
    : raw.result === 'pass'
      ? 'PASS'
      : raw.result === 'fail'
        ? 'FAIL'
        : undefined
  const score = asFiniteNumber(raw.score)
  const createdAt = asString(raw.createdAt)
  if (!stage || !result || !createdAt) return null

  const reviewType = raw.reviewType === 'business' || raw.reviewType === 'compliance'
    ? raw.reviewType
    : 'business'
  const feedback = asString(raw.feedback)
    || [asString(raw.businessReview), asString(raw.complianceReview)].filter(Boolean).join('\n\n')
  const issues = Array.isArray(raw.issues)
    ? raw.issues
      .map((issue) => {
        const issueRecord = asRecord(issue)
        const severity = issueRecord.severity === 'critical' || issueRecord.severity === 'major' || issueRecord.severity === 'minor'
          ? issueRecord.severity
          : 'minor'
        const description = asString(issueRecord.description)
        if (!description) return null
        return {
          severity,
          description,
          location: asString(issueRecord.location),
          suggestion: asString(issueRecord.suggestion)
        }
      })
      .filter((issue): issue is ReviewIssue => !!issue)
    : []

  return {
    stage,
    reviewType,
    result,
    passed: result === 'PASS',
    score: score ?? 0,
    feedback: feedback || '',
    issues,
    createdAt
  }
}


function cloneLogEntryArray(value: unknown): import('@shared/types').LogEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => {
      const level = entry.level === 'info' || entry.level === 'warn' || entry.level === 'error' || entry.level === 'success'
        ? entry.level
        : 'info'
      const timestamp = asString(entry.timestamp)
      const message = asString(entry.message)
      if (!timestamp || !message) return null
      return {
        level,
        message,
        timestamp,
        detail: asString(entry.detail),
        meta: entry.meta && typeof entry.meta === 'object' && !Array.isArray(entry.meta)
          ? entry.meta as Record<string, unknown>
          : undefined
      }
    })
    .filter((entry): entry is import('@shared/types').LogEntry => !!entry)
}

function getRuntimeStatus(state: PipelineState): 'running' | 'paused' | 'terminal' {
  if (state === 'paused') return 'paused'
  if (['idle', 'director_done', 'art_done', 'episode_complete', 'error'].includes(state)) return 'terminal'
  return 'running'
}

function normalizePipelineContext(value: unknown, projectId: string): PipelineContext | null {
  const raw = asRecord(value)
  const currentStage = raw.currentStage === 'director' || raw.currentStage === 'art' || raw.currentStage === 'storyboard'
    ? raw.currentStage
    : 'director'
  const state = typeof raw.state === 'string' ? raw.state as PipelineState : 'idle'
  const runId = asString(raw.runId)
  const projectPath = asString(raw.projectPath)
  const episodeNum = asNonNegativeInteger(raw.episodeNum)
  if (!runId || !projectPath || !episodeNum) return null
  return {
    runId,
    projectId: asString(raw.projectId) || projectId,
    projectPath,
    episodeNum,
    currentStage,
    state,
    singleStage: typeof raw.singleStage === 'boolean' ? raw.singleStage : undefined,
    retryCount: asNonNegativeInteger(raw.retryCount) ?? 0,
    runStartedAt: asString(raw.runStartedAt),
    runEndedAt: asString(raw.runEndedAt),
    lastUpdatedAt: asString(raw.lastUpdatedAt),
    scriptPath: asString(raw.scriptPath),
    directorAnalysisPath: asString(raw.directorAnalysisPath),
    seedancePromptsPath: asString(raw.seedancePromptsPath),
    reviews: Array.isArray(raw.reviews)
      ? raw.reviews.map((review) => normalizeReview(review)).filter((review): review is ReviewResult => !!review)
      : [],
    logs: cloneLogEntryArray(raw.logs),
    lastReviewFeedback: asString(raw.lastReviewFeedback),
    error: asString(raw.error)
  }
}

export function normalizeProjectStateContent(input: unknown, projectIdFallback = ''): PersistedProjectStateLike {
  const raw = asRecord(input)
  const projectId = asString(raw.projectId) || projectIdFallback
  const episodesRaw = asRecord(raw.episodes)
  const episodes = Object.entries(episodesRaw).reduce<Record<number, PersistedEpisodeState>>((acc, [episodeKey, value]) => {
    const rawEpisode = asRecord(value)
    const episodeNum = asNonNegativeInteger(rawEpisode.episodeNum) ?? asNonNegativeInteger(Number(episodeKey))
    if (!episodeNum) return acc
    const status = rawEpisode.status === 'idle' || rawEpisode.status === 'director' || rawEpisode.status === 'art' || rawEpisode.status === 'storyboard' || rawEpisode.status === 'complete'
      ? rawEpisode.status
      : 'idle'
    const lastStage = rawEpisode.lastStage === 'director' || rawEpisode.lastStage === 'art' || rawEpisode.lastStage === 'storyboard'
      ? rawEpisode.lastStage
      : 'director'
    acc[episodeNum] = {
      episodeNum,
      status,
      lastStage,
      completedStages: Array.isArray(rawEpisode.completedStages)
        ? rawEpisode.completedStages.filter((stage): stage is PipelineStage => stage === 'director' || stage === 'art' || stage === 'storyboard')
        : [],
      reviews: Array.isArray(rawEpisode.reviews)
        ? rawEpisode.reviews.map((review) => normalizeReview(review)).filter((review): review is ReviewResult => !!review)
        : [],
      totalDurationSeconds: asNonNegativeInteger(rawEpisode.totalDurationSeconds) ?? 0,
      updatedAt: asString(rawEpisode.updatedAt) || new Date().toISOString()
    }
    return acc
  }, {})

  const runtimeRaw = asRecord(raw.runtime)
  const runtimeContext = normalizePipelineContext(runtimeRaw.context, projectId)
  const runtime = runtimeContext
    ? {
      context: runtimeContext,
      status: runtimeRaw.status === 'running' || runtimeRaw.status === 'paused' || runtimeRaw.status === 'terminal'
        ? runtimeRaw.status
        : getRuntimeStatus(runtimeContext.state),
      updatedAt: asString(runtimeRaw.updatedAt) || new Date().toISOString()
    }
    : undefined

  return {
    version: asNonNegativeInteger(raw.version) || PROJECT_STATE_VERSION,
    projectId,
    runtime,
    episodes,
    updatedAt: asString(raw.updatedAt) || new Date().toISOString()
  }
}

function inferArtifactContentType(filePath: string): string {
  return extname(filePath).toLowerCase() === '.json' ? 'application/json' : 'text/markdown'
}

function getArtifactScopeKey(params: { kind: ArtifactKind; episodeNum?: number; filePath: string }): string {
  return `${params.kind}:${params.episodeNum ?? 'global'}:${params.filePath}`
}

export function normalizeArtifactManifestContent(input: unknown, projectPath: string): ArtifactManifest {
  const raw = asRecord(input)
  const now = new Date().toISOString()
  const normalizedArtifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts
      .map((artifact) => asRecord(artifact))
      .map((artifact, index) => {
        const kind = artifact.kind as ArtifactKind
        const filePath = asString(artifact.filePath)
        if (!kind || !filePath) return null
        const episodeNum = asNonNegativeInteger(artifact.episodeNum)
        return {
          id: asString(artifact.id) || `artifact-${index + 1}`,
          projectPath,
          kind,
          label: asString(artifact.label) || kind,
          scopeKey: asString(artifact.scopeKey) || getArtifactScopeKey({ kind, episodeNum, filePath }),
          filePath,
          snapshotPath: asString(artifact.snapshotPath) || filePath,
          episodeNum,
          stage: artifact.stage as PipelineStage | AdaptStage | undefined,
          sourceRunId: asString(artifact.sourceRunId),
          createdBy: artifact.createdBy === 'user' || artifact.createdBy === 'rollback' ? artifact.createdBy : 'system',
          version: asNonNegativeInteger(artifact.version) || 1,
          contentType: asString(artifact.contentType) || inferArtifactContentType(filePath),
          sizeBytes: asNonNegativeInteger(artifact.sizeBytes) || 0,
          hash: asString(artifact.hash) || '',
          isCurrent: typeof artifact.isCurrent === 'boolean' ? artifact.isCurrent : true,
          createdAt: asString(artifact.createdAt) || now,
          metadata: artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
            ? artifact.metadata as Record<string, unknown>
            : undefined
        } satisfies ArtifactRecord
      })
      .filter((artifact): artifact is ArtifactRecord => !!artifact)
    : []

  const currentByScope = new Map<string, ArtifactRecord>()
  for (const artifact of normalizedArtifacts) {
    const current = currentByScope.get(artifact.scopeKey)
    if (!current || artifact.version >= current.version) {
      currentByScope.set(artifact.scopeKey, artifact)
    }
  }
  for (const artifact of normalizedArtifacts) {
    artifact.isCurrent = currentByScope.get(artifact.scopeKey)?.id === artifact.id
  }

  return {
    version: asNonNegativeInteger(raw.version) || ARTIFACT_MANIFEST_VERSION,
    projectPath,
    artifacts: normalizedArtifacts,
    updatedAt: asString(raw.updatedAt) || now
  }
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function normalizeFile<T>(kind: ProjectDataFileKind, projectPath: string, rawText: string): NormalizedFileResult<T> {
  const parsed = JSON.parse(rawText) as unknown
  const record = asRecord(parsed)

  if (kind === 'projectConfig') {
    const data = normalizeProjectConfigContent(parsed)
    return {
      data: data as T,
      currentVersion: PROJECT_CONFIG_VERSION,
      fromVersion: asNonNegativeInteger(record.version) ?? null,
      changed: stableJson(parsed) !== stableJson(data)
    }
  }

  if (kind === 'adaptPlan') {
    const data = normalizeAdaptPlanContent(parsed)
    return {
      data: data as T,
      currentVersion: ADAPT_PLAN_VERSION,
      fromVersion: asNonNegativeInteger(record.version) ?? null,
      changed: stableJson(parsed) !== stableJson(data)
    }
  }

  if (kind === 'projectState') {
    const data = normalizeProjectStateContent(parsed)
    return {
      data: data as T,
      currentVersion: PROJECT_STATE_VERSION,
      fromVersion: asNonNegativeInteger(record.version) ?? null,
      changed: stableJson(parsed) !== stableJson(data)
    }
  }

  const data = normalizeArtifactManifestContent(parsed, projectPath)
  return {
    data: data as T,
    currentVersion: ARTIFACT_MANIFEST_VERSION,
    fromVersion: asNonNegativeInteger(record.version) ?? null,
    changed: stableJson(parsed) !== stableJson(data)
  }
}

function getBackupRelativePath(runId: string, relativePath: string): string {
  return join('outputs', 'system', 'migration-backups', runId, relativePath)
}

function getReportDir(projectPath: string): string {
  return join(projectPath, 'outputs', 'system', 'migration-reports')
}

function createReport(projectPath: string, entries: ProjectDataMigrationEntry[]): ProjectDataMigrationReport {
  return {
    version: PROJECT_DATA_REPORT_VERSION,
    projectPath,
    generatedAt: new Date().toISOString(),
    summary: {
      checked: entries.length,
      migrated: entries.filter((entry) => entry.status === 'migrated').length,
      missing: entries.filter((entry) => entry.status === 'missing').length,
      errors: entries.filter((entry) => entry.status === 'error').length
    },
    entries
  }
}

async function writeReportFiles(projectPath: string, report: ProjectDataMigrationReport): Promise<void> {
  const reportDir = getReportDir(projectPath)
  await mkdir(reportDir, { recursive: true })
  const latestPath = join(reportDir, 'project-data-latest.json')
  await writeFile(latestPath, stableJson(report), 'utf-8')
  if (report.summary.migrated > 0 || report.summary.errors > 0) {
    const stampedPath = join(reportDir, `project-data-${report.generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`)
    await writeFile(stampedPath, stableJson(report), 'utf-8')
  }
}

function writeReportFilesSync(projectPath: string, report: ProjectDataMigrationReport): void {
  const reportDir = getReportDir(projectPath)
  mkdirSync(reportDir, { recursive: true })
  const latestPath = join(reportDir, 'project-data-latest.json')
  writeFileSync(latestPath, stableJson(report), 'utf-8')
  if (report.summary.migrated > 0 || report.summary.errors > 0) {
    const stampedPath = join(reportDir, `project-data-${report.generatedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.json`)
    writeFileSync(stampedPath, stableJson(report), 'utf-8')
  }
}

export function getProjectDataFilePath(projectPath: string, kind: ProjectDataFileKind): string {
  return join(projectPath, FILE_PATHS[kind])
}

export async function ensureProjectDataFile<T>(projectPath: string, kind: ProjectDataFileKind): Promise<{
  data: T | null
  entry: ProjectDataMigrationEntry
}> {
  const relativePath = FILE_PATHS[kind]
  const absolutePath = getProjectDataFilePath(projectPath, kind)
  if (!existsSync(absolutePath)) {
    return {
      data: null,
      entry: {
        kind,
        relativePath,
        existed: false,
        status: 'missing',
        fromVersion: null,
        toVersion: kind === 'projectConfig'
          ? PROJECT_CONFIG_VERSION
          : kind === 'adaptPlan'
            ? ADAPT_PLAN_VERSION
            : kind === 'projectState'
              ? PROJECT_STATE_VERSION
              : ARTIFACT_MANIFEST_VERSION
      }
    }
  }

  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

  try {
    const rawText = await readFile(absolutePath, 'utf-8')
    const normalized = normalizeFile<T>(kind, projectPath, rawText)
    let backupPath: string | undefined

    if (normalized.changed) {
      backupPath = getBackupRelativePath(runId, relativePath)
      const backupAbsolutePath = join(projectPath, backupPath)
      await mkdir(dirname(backupAbsolutePath), { recursive: true })
      await copyFile(absolutePath, backupAbsolutePath)
      await writeFile(absolutePath, stableJson(normalized.data), 'utf-8')
    }

    return {
      data: normalized.data,
      entry: {
        kind,
        relativePath,
        existed: true,
        status: normalized.changed ? 'migrated' : 'unchanged',
        fromVersion: normalized.fromVersion,
        toVersion: normalized.currentVersion,
        backupPath
      }
    }
  } catch (error) {
    return {
      data: null,
      entry: {
        kind,
        relativePath,
        existed: true,
        status: 'error',
        fromVersion: null,
        toVersion: kind === 'projectConfig'
          ? PROJECT_CONFIG_VERSION
          : kind === 'adaptPlan'
            ? ADAPT_PLAN_VERSION
            : kind === 'projectState'
              ? PROJECT_STATE_VERSION
              : ARTIFACT_MANIFEST_VERSION,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function ensureProjectDataFileSync<T>(projectPath: string, kind: ProjectDataFileKind): {
  data: T | null
  entry: ProjectDataMigrationEntry
} {
  const relativePath = FILE_PATHS[kind]
  const absolutePath = getProjectDataFilePath(projectPath, kind)
  if (!existsSync(absolutePath)) {
    return {
      data: null,
      entry: {
        kind,
        relativePath,
        existed: false,
        status: 'missing',
        fromVersion: null,
        toVersion: kind === 'projectConfig'
          ? PROJECT_CONFIG_VERSION
          : kind === 'adaptPlan'
            ? ADAPT_PLAN_VERSION
            : kind === 'projectState'
              ? PROJECT_STATE_VERSION
              : ARTIFACT_MANIFEST_VERSION
      }
    }
  }

  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

  try {
    const rawText = readFileSync(absolutePath, 'utf-8')
    const normalized = normalizeFile<T>(kind, projectPath, rawText)
    let backupPath: string | undefined

    if (normalized.changed) {
      backupPath = getBackupRelativePath(runId, relativePath)
      const backupAbsolutePath = join(projectPath, backupPath)
      mkdirSync(dirname(backupAbsolutePath), { recursive: true })
      copyFileSync(absolutePath, backupAbsolutePath)
      writeFileSync(absolutePath, stableJson(normalized.data), 'utf-8')
    }

    return {
      data: normalized.data,
      entry: {
        kind,
        relativePath,
        existed: true,
        status: normalized.changed ? 'migrated' : 'unchanged',
        fromVersion: normalized.fromVersion,
        toVersion: normalized.currentVersion,
        backupPath
      }
    }
  } catch (error) {
    return {
      data: null,
      entry: {
        kind,
        relativePath,
        existed: true,
        status: 'error',
        fromVersion: null,
        toVersion: kind === 'projectConfig'
          ? PROJECT_CONFIG_VERSION
          : kind === 'adaptPlan'
            ? ADAPT_PLAN_VERSION
            : kind === 'projectState'
              ? PROJECT_STATE_VERSION
              : ARTIFACT_MANIFEST_VERSION,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export async function ensureProjectDataCompatibility(projectPath: string): Promise<ProjectDataMigrationReport> {
  const kinds: ProjectDataFileKind[] = ['projectConfig', 'adaptPlan', 'projectState', 'artifactManifest']
  const results = await Promise.all(kinds.map((kind) => ensureProjectDataFile(projectPath, kind)))
  const report = createReport(projectPath, results.map((result) => result.entry))
  await writeReportFiles(projectPath, report)
  return report
}

export function ensureProjectDataCompatibilitySync(projectPath: string): ProjectDataMigrationReport {
  const kinds: ProjectDataFileKind[] = ['projectConfig', 'adaptPlan', 'projectState', 'artifactManifest']
  const results = kinds.map((kind) => ensureProjectDataFileSync(projectPath, kind))
  const report = createReport(projectPath, results.map((result) => result.entry))
  writeReportFilesSync(projectPath, report)
  return report
}
