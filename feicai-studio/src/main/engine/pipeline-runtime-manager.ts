import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { v4 as uuid } from 'uuid'
import { IPC } from '@shared/ipc-channels'
import type {
  PipelineAutomationAlert,
  PipelineContext,
  PipelineDependencyCondition,
  PipelineQueueSnapshot,
  PipelineRunDetail,
  PipelineRuntimeDiagnostics,
  PipelineRuntimeIssue,
  PipelineRunPriority,
  PipelineRunRecord,
  PipelineRunStatus,
  PipelineStage,
  PipelineState,
  PipelineSettings,
  Project,
  ProjectTaskAlertConfig,
  ProjectTaskSchedule,
  ProjectTaskTemplate,
  PipelineTaskOrchestration,
  PipelineTaskStrategy
} from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS, DEFAULT_PROJECT_TASK_ALERTS, DEFAULT_PROJECT_TASK_DEFAULTS } from '@shared/types'
import { resolveProjectTaskSettings } from '@shared/project-task-settings'
import { validateProjectTaskAutomation } from '@shared/project-task-validation'
import { buildAutomationKey, resolveScheduleOccurrence } from '@shared/pipeline-automation'
import type { ProjectContext } from './prompt-assembler'
import { PipelineStateMachine } from './state-machine'
import { readProjectStateFile, recoverPipelineContext } from './project-state'
import {
  archivePipelineRuns,
  cancelQueuedPipelineRun,
  getDefaultLLMConfig,
  getLatestPipelineRunByRootRunId,
  getPipelineRunByAutomationKey,
  getPipelineRunDetail,
  getPipelineRunPayload,
  getPipelineRuntimeTelemetrySummary,
  listRecoverablePipelineRuns,
  listProjects,
  listPipelineRuns,
  listAllPipelineRuns,
  listQueuedPipelineRuns,
  markPipelineRunDeadLetter,
  nextPipelineQueuePosition,
  savePipelineRunLLMCall,
  savePipelineRunLog,
  touchPipelineRunHeartbeat,
  updatePipelineRunPayload,
  updatePipelineRunQueuePosition,
  upsertPipelineRun
} from '../db/queries'
import { readProjectConfigSync } from '../project/project-config-store'

const AUTOMATION_POLL_MS = 30_000
const RECOVERY_SWEEP_MS = 60_000
const RUN_HEARTBEAT_MS = 15_000
const RUN_STALE_MS = 2 * 60_000
const PAUSED_STALE_MS = 10 * 60_000
const STREAM_FLUSH_MS = 60

interface PendingStreamBroadcast {
  stage: PipelineStage
  chunk: string
  totalLength: number
}

export interface PipelineStartParams {
  projectId: string
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  startStage?: PipelineStage
  singleStage?: boolean
  strategy?: Partial<PipelineTaskStrategy>
  orchestration?: Partial<PipelineTaskOrchestration>
}

export interface PipelineActiveRun {
  runId: string
  projectId: string
  projectPath: string
  episodeNum: number
  state: PipelineState
  currentStage: PipelineStage
  startedAt?: string
  updatedAt?: string
}

interface QueueRunMeta {
  runId: string
  queuedAt: string
  queuePosition?: number
  params: PipelineStartParams
  strategy: PipelineTaskStrategy
  orchestration: PipelineTaskOrchestration
}

const PRIORITY_WEIGHT: Record<PipelineRunPriority, number> = {
  high: 0,
  normal: 1,
  low: 2
}

function normalizeStrategy(runId: string, strategy?: Partial<PipelineTaskStrategy>): PipelineTaskStrategy {
  const maxAutoRetries = Math.max(0, Math.min(3, Number(strategy?.maxAutoRetries ?? 0)))
  const attempt = Math.max(0, Number(strategy?.attempt ?? 0))
  const priority = (strategy?.priority || 'normal') as PipelineRunPriority

  return {
    batchId: strategy?.batchId,
    batchLabel: strategy?.batchLabel,
    priority: ['high', 'normal', 'low'].includes(priority) ? priority : 'normal',
    maxAutoRetries,
    attempt,
    rootRunId: strategy?.rootRunId || runId,
    templateId: strategy?.templateId,
    templateLabel: strategy?.templateLabel
  }
}

function normalizeOrchestration(orchestration?: Partial<PipelineTaskOrchestration>): PipelineTaskOrchestration {
  const condition = orchestration?.condition
  return {
    dependsOnRootRunId: orchestration?.dependsOnRootRunId,
    condition: condition === 'on_success' || condition === 'on_failure' ? condition : 'always',
    scheduledAt: orchestration?.scheduledAt,
    scheduleId: orchestration?.scheduleId,
    scheduleLabel: orchestration?.scheduleLabel,
    automationKey: orchestration?.automationKey
  }
}

function isTerminalState(state: PipelineState): boolean {
  return ['idle', 'director_done', 'art_done', 'episode_complete', 'error'].includes(state)
}

function shouldKeepActiveRun(state: PipelineState): boolean {
  return state === 'paused' || !isTerminalState(state)
}

function toRunStatus(state: PipelineState): PipelineRunStatus {
  if (state === 'paused') return 'paused'
  if (state === 'episode_complete' || state === 'director_done' || state === 'art_done') return 'completed'
  if (state === 'error') return 'failed'
  if (state === 'idle') return 'aborted'
  return 'running'
}

function toActiveRun(context: PipelineContext): PipelineActiveRun | null {
  if (!context.runId || !context.projectPath || !shouldKeepActiveRun(context.state)) {
    return null
  }

  return {
    runId: context.runId,
    projectId: context.projectId,
    projectPath: context.projectPath,
    episodeNum: context.episodeNum,
    state: context.state,
    currentStage: context.currentStage,
    startedAt: context.runStartedAt,
    updatedAt: context.lastUpdatedAt
  }
}

function toRunRecord(context: PipelineContext, meta?: QueueRunMeta): PipelineRunRecord | null {
  if (!context.runId || !context.projectId) return null

  return {
    runId: context.runId,
    projectId: context.projectId,
    projectPath: context.projectPath,
    episodeNum: context.episodeNum,
    currentStage: context.currentStage,
    status: toRunStatus(context.state),
    state: context.state,
    singleStage: !!context.singleStage,
    queuedAt: meta?.queuedAt || context.runStartedAt || context.lastUpdatedAt || new Date().toISOString(),
    startedAt: context.runStartedAt || context.lastUpdatedAt || new Date().toISOString(),
    endedAt: context.runEndedAt,
    lastUpdatedAt: context.lastUpdatedAt || new Date().toISOString(),
    errorMessage: context.error,
    batchId: meta?.strategy.batchId,
    batchLabel: meta?.strategy.batchLabel,
    priority: meta?.strategy.priority || 'normal',
    maxAutoRetries: meta?.strategy.maxAutoRetries || 0,
    attempt: meta?.strategy.attempt || 0,
    rootRunId: meta?.strategy.rootRunId || context.runId,
    workerSlot: shouldKeepActiveRun(context.state) || isTerminalState(context.state) ? 1 : undefined,
    dependsOnRootRunId: meta?.orchestration.dependsOnRootRunId,
    triggerCondition: meta?.orchestration.condition || 'always',
    scheduledAt: meta?.orchestration.scheduledAt,
    templateId: meta?.strategy.templateId,
    templateLabel: meta?.strategy.templateLabel,
    scheduleId: meta?.orchestration.scheduleId,
    scheduleLabel: meta?.orchestration.scheduleLabel,
    automationKey: meta?.orchestration.automationKey
  }
}

function getSkillsDir(): string {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  if (isDev) {
    return join(process.cwd(), 'resources', 'builtin-skills')
  }
  return join(process.resourcesPath, 'builtin-skills')
}

export class PipelineRuntimeManager {
  private engine: PipelineStateMachine | null = null
  private activeRun: PipelineActiveRun | null = null
  private currentRun: QueueRunMeta | null = null
  private queuedRuns: QueueRunMeta[] = []
  private queueReady: Promise<void>
  private queueRestoreFinished = false
  private launchingQueuedRun = false
  private queueWakeTimer: NodeJS.Timeout | null = null
  private queueWakeAt?: string
  private automationTimer: NodeJS.Timeout | null = null
  private automationSweepRunning = false
  private lastAutomationScanAt?: string
  private lastAutomationScanError?: string
  private recoveryTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pendingStreamBroadcast: PendingStreamBroadcast | null = null
  private streamFlushTimer: NodeJS.Timeout | null = null
  private lastRecoverySweepAt?: string
  private lastRecoverySweepError?: string
  private orphanedRunCount = 0

  constructor() {
    try {
      archivePipelineRuns(7)
    } catch {
      // 数据库尚未就绪时忽略，后续 IPC 初始化后仍可正常运行
    }
    this.queueReady = this.restoreQueuedRuns().then(async () => {
      await this.runRecoverySweep({ startup: true })
    })
    this.startAutomationLoop()
    this.startRecoveryLoop()
  }

  private startRecoveryLoop(): void {
    if (this.recoveryTimer) return

    this.recoveryTimer = setInterval(() => {
      void this.runRecoverySweep()
    }, RECOVERY_SWEEP_MS)
  }

  private startHeartbeat(runId: string): void {
    this.stopHeartbeat()
    touchPipelineRunHeartbeat(runId)
    this.heartbeatTimer = setInterval(() => {
      touchPipelineRunHeartbeat(runId)
    }, RUN_HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(channel: string, data: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  private flushPendingStreamBroadcast(): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer)
      this.streamFlushTimer = null
    }
    if (!this.pendingStreamBroadcast) return
    this.send(IPC.PIPELINE_STREAM, this.pendingStreamBroadcast)
    this.pendingStreamBroadcast = null
  }

  private queueStreamBroadcast(data: { stage: PipelineStage; chunk: string; totalLength: number }): void {
    const pending = this.pendingStreamBroadcast
    if (!pending || pending.stage !== data.stage) {
      this.flushPendingStreamBroadcast()
      this.pendingStreamBroadcast = {
        stage: data.stage,
        chunk: data.chunk,
        totalLength: data.totalLength
      }
    } else {
      pending.chunk += data.chunk
      pending.totalLength = data.totalLength
    }

    if (this.streamFlushTimer) return
    this.streamFlushTimer = setTimeout(() => {
      this.flushPendingStreamBroadcast()
    }, STREAM_FLUSH_MS)
  }

  private buildProjectContext(params: PipelineStartParams): ProjectContext {
    const config = readProjectConfigSync(params.projectPath)
    const settings = { ...DEFAULT_PIPELINE_SETTINGS, ...(config?.pipelineSettings || {}) }
    return {
      ...params.projectContext,
      episodeNumber: params.episodeNum,
      durationMin: settings.durationMin,
      durationMax: settings.durationMax,
      singlePromptMax: settings.singlePromptMax
    }
  }

  private getProjectTaskDefaults(projectPath: string) {
    const config = readProjectConfigSync(projectPath)
    return {
      ...DEFAULT_PROJECT_TASK_DEFAULTS,
      ...(config?.taskDefaults || {})
    }
  }

  private getProjectTaskAlerts(projectPath: string): ProjectTaskAlertConfig {
    const config = readProjectConfigSync(projectPath)
    return {
      ...DEFAULT_PROJECT_TASK_ALERTS,
      ...(config?.taskAlerts || {})
    }
  }

  private configureEngine(params: PipelineStartParams): void {
    const llmConfig = getDefaultLLMConfig()
    if (!llmConfig) {
      throw new Error('请先在设置中配置 LLM 模型')
    }

    const config = readProjectConfigSync(params.projectPath)
    const settings: Partial<PipelineSettings> = config?.pipelineSettings || {}
    const engine = this.getEngine()
    engine.setProvider(llmConfig)
    engine.setPipelineSettings(settings)
  }

  private makeQueuedRecord(meta: QueueRunMeta): PipelineRunRecord {
    return {
      runId: meta.runId,
      projectId: meta.params.projectId,
      projectPath: meta.params.projectPath,
      episodeNum: meta.params.episodeNum,
      currentStage: meta.params.startStage || 'director',
      status: 'queued',
      state: 'idle',
      singleStage: !!meta.params.singleStage,
      queuedAt: meta.queuedAt,
      startedAt: undefined,
      endedAt: undefined,
      lastUpdatedAt: meta.queuedAt,
      queuePosition: meta.queuePosition,
      batchId: meta.strategy.batchId,
      batchLabel: meta.strategy.batchLabel,
      priority: meta.strategy.priority,
      maxAutoRetries: meta.strategy.maxAutoRetries,
      attempt: meta.strategy.attempt,
      rootRunId: meta.strategy.rootRunId,
      archivedAt: undefined,
      dependsOnRootRunId: meta.orchestration.dependsOnRootRunId,
      triggerCondition: meta.orchestration.condition,
      scheduledAt: meta.orchestration.scheduledAt,
      templateId: meta.strategy.templateId,
      templateLabel: meta.strategy.templateLabel,
      scheduleId: meta.orchestration.scheduleId,
      scheduleLabel: meta.orchestration.scheduleLabel,
      automationKey: meta.orchestration.automationKey
    }
  }

  private makeActiveRunPlaceholder(meta: QueueRunMeta): PipelineActiveRun {
    return {
      runId: meta.runId,
      projectId: meta.params.projectId,
      projectPath: meta.params.projectPath,
      episodeNum: meta.params.episodeNum,
      state: 'idle',
      currentStage: meta.params.startStage || 'director',
      updatedAt: meta.queuedAt
    }
  }

  private rebuildQueuePositions(): void {
    this.queuedRuns = this.queuedRuns
      .sort((a, b) => {
        const priorityDiff = PRIORITY_WEIGHT[a.strategy.priority] - PRIORITY_WEIGHT[b.strategy.priority]
        if (priorityDiff !== 0) return priorityDiff
        const aPos = a.queuePosition ?? Number.MAX_SAFE_INTEGER
        const bPos = b.queuePosition ?? Number.MAX_SAFE_INTEGER
        if (aPos !== bPos) return aPos - bPos
        return a.queuedAt.localeCompare(b.queuedAt)
      })
      .map((item, index) => {
        const nextPosition = index + 1
        if (item.queuePosition !== nextPosition) {
          updatePipelineRunQueuePosition(item.runId, nextPosition)
        }
        return { ...item, queuePosition: nextPosition }
      })
  }

  private scheduleQueueWake(nextAt?: string): void {
    if (this.queueWakeTimer) {
      clearTimeout(this.queueWakeTimer)
      this.queueWakeTimer = null
    }
    this.queueWakeAt = undefined

    if (!nextAt) return
    const targetMs = new Date(nextAt).getTime()
    if (!Number.isFinite(targetMs)) return

    const delay = Math.max(0, targetMs - Date.now())
    this.queueWakeAt = nextAt
    this.queueWakeTimer = setTimeout(() => {
      this.queueWakeTimer = null
      this.queueWakeAt = undefined
      this.kickQueue()
    }, delay)
  }

  private hydrateQueuedRun(
    item: Pick<PipelineRunRecord, 'runId' | 'queuedAt' | 'queuePosition' | 'batchId' | 'batchLabel' | 'priority' | 'maxAutoRetries' | 'attempt' | 'rootRunId' | 'templateId' | 'templateLabel' | 'dependsOnRootRunId' | 'triggerCondition' | 'scheduledAt' | 'scheduleId' | 'scheduleLabel' | 'automationKey' | 'currentStage' | 'singleStage'>,
    payload: Record<string, unknown> | null
  ): QueueRunMeta | null {
    if (!payload) {
      markPipelineRunDeadLetter(item.runId, '队列任务缺少 payload，无法恢复执行。', { state: 'error' })
      return null
    }

    const projectId = typeof payload.projectId === 'string' ? payload.projectId : null
    const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath : null
    const episodeNum = typeof payload.episodeNum === 'number' ? payload.episodeNum : null
    const projectContext = typeof payload.projectContext === 'object' && payload.projectContext
      ? payload.projectContext as ProjectContext
      : null

    if (!projectId || !projectPath || !episodeNum || !projectContext) {
      markPipelineRunDeadLetter(item.runId, '队列任务 payload 不完整，无法恢复执行。', { state: 'error' })
      return null
    }

    const strategy = normalizeStrategy(item.runId, {
      batchId: item.batchId,
      batchLabel: item.batchLabel,
      priority: item.priority,
      maxAutoRetries: item.maxAutoRetries,
      attempt: item.attempt,
      rootRunId: item.rootRunId,
      templateId: item.templateId,
      templateLabel: item.templateLabel
    })
    const orchestration = normalizeOrchestration({
      dependsOnRootRunId: item.dependsOnRootRunId,
      condition: item.triggerCondition,
      scheduledAt: item.scheduledAt,
      scheduleId: item.scheduleId,
      scheduleLabel: item.scheduleLabel,
      automationKey: item.automationKey
    })

    return {
      runId: item.runId,
      queuedAt: item.queuedAt,
      queuePosition: item.queuePosition,
      strategy,
      orchestration,
      params: {
        projectId,
        projectPath,
        episodeNum,
        projectContext,
        startStage: item.currentStage,
        singleStage: item.singleStage,
        strategy,
        orchestration
      }
    }
  }

  private async restoreQueuedRuns(): Promise<void> {
    const restored = (() => {
      try {
        return listQueuedPipelineRuns()
      } catch {
        return []
      }
    })()
      .map((item) => this.hydrateQueuedRun(item, item.payload))
      .filter((item): item is QueueRunMeta => !!item)

    this.queuedRuns = restored
    this.rebuildQueuePositions()
    this.queueRestoreFinished = true
    this.kickQueue()
  }

  private async ensureQueueReady(): Promise<void> {
    await this.queueReady
  }

  private hasRunningEngine(): boolean {
    if (!this.engine) {
      return !!this.currentRun
    }

    const context = this.engine.getContext()
    if (context.state === 'paused') return true
    return !isTerminalState(context.state)
  }

  private hasPendingWork(): boolean {
    return this.hasRunningEngine() || this.launchingQueuedRun || this.queuedRuns.length > 0
  }

  private cancelQueuedRuns(
    matcher: (item: QueueRunMeta) => boolean,
    reason: string
  ): number {
    let cancelled = 0
    this.queuedRuns = this.queuedRuns.filter((item) => {
      if (!matcher(item)) return true
      cancelQueuedPipelineRun(item.runId, reason)
      cancelled += 1
      return false
    })

    if (cancelled > 0) {
      this.rebuildQueuePositions()
    }

    return cancelled
  }

  private createQueueMeta(params: PipelineStartParams): QueueRunMeta {
    const runId = uuid()
    const queuedAt = new Date().toISOString()
    const defaults = this.getProjectTaskDefaults(params.projectPath)
    try {
      archivePipelineRuns(defaults.archiveAfterDays, params.projectId)
    } catch {
      // 忽略归档失败，不阻断入队
    }
    const strategy = normalizeStrategy(runId, {
      priority: defaults.defaultPriority,
      maxAutoRetries: defaults.defaultMaxAutoRetries,
      ...params.strategy
    })
    const orchestration = normalizeOrchestration(params.orchestration)

    return {
      runId,
      queuedAt,
      queuePosition: nextPipelineQueuePosition(),
      strategy,
      orchestration,
      params: {
        ...params,
        strategy,
        orchestration
      }
    }
  }

  private persistQueuedRun(meta: QueueRunMeta): PipelineRunRecord {
    const record = this.makeQueuedRecord(meta)
    upsertPipelineRun(record)
    updatePipelineRunPayload(meta.runId, {
      ...meta.params,
      projectContext: this.buildProjectContext(meta.params),
      strategy: meta.strategy,
      orchestration: meta.orchestration
    })
    return record
  }

  private enqueueRetry(meta: QueueRunMeta): PipelineRunRecord {
    const retryMeta = this.createQueueMeta({
      ...meta.params,
      strategy: {
        ...meta.strategy,
        attempt: meta.strategy.attempt + 1,
        rootRunId: meta.strategy.rootRunId
      },
      orchestration: meta.orchestration
    })

    this.persistQueuedRun(retryMeta)
    this.queuedRuns.push(retryMeta)
    this.rebuildQueuePositions()
    return this.makeQueuedRecord(this.queuedRuns.find((item) => item.runId === retryMeta.runId) || retryMeta)
  }

  private finalizeCurrentRun(record: PipelineRunRecord): void {
    this.stopHeartbeat()
    if (!this.currentRun || this.currentRun.runId !== record.runId) {
      return
    }

    const current = this.currentRun
    const shouldAutoRetry = record.status === 'failed' &&
      current.strategy.attempt < current.strategy.maxAutoRetries

    this.currentRun = null
    this.activeRun = null

    if (shouldAutoRetry) {
      this.enqueueRetry(current)
    } else if (record.status === 'failed') {
      this.notifyRunFailure(record, current)
    }

    this.kickQueue()
  }

  private sendAutomationAlert(alert: PipelineAutomationAlert): void {
    if (!alert.toastNotifications && !alert.desktopNotifications) {
      return
    }
    this.send(IPC.PIPELINE_ALERT, alert)
  }

  private notifyRunFailure(record: PipelineRunRecord, meta: QueueRunMeta): void {
    const alerts = this.getProjectTaskAlerts(meta.params.projectPath)
    if (!alerts.notifyOnRunFailed) return

    this.sendAutomationAlert({
      type: 'run_failed',
      projectId: meta.params.projectId,
      projectPath: meta.params.projectPath,
      projectName: meta.params.projectContext.projectName,
      title: `任务失败 · EP${String(record.episodeNum).padStart(3, '0')}`,
      message: record.errorMessage || `${record.currentStage} 阶段执行失败`,
      runId: record.runId,
      rootRunId: record.rootRunId,
      scheduleId: record.scheduleId,
      scheduleLabel: record.scheduleLabel,
      templateId: record.templateId,
      templateLabel: record.templateLabel,
      toastNotifications: alerts.toastNotifications,
      desktopNotifications: alerts.desktopNotifications,
      createdAt: new Date().toISOString()
    })
  }

  private startAutomationLoop(): void {
    if (this.automationTimer) return

    void this.processAutomationSchedules()
    this.automationTimer = setInterval(() => {
      void this.processAutomationSchedules()
    }, AUTOMATION_POLL_MS)
  }

  private buildProjectRuntimeContext(project: Project, episodeNum: number): ProjectContext {
    return {
      projectName: project.name,
      visualStyle: project.visualStyle,
      targetMedium: project.targetMedium,
      episodeNumber: episodeNum,
      durationMin: 90,
      durationMax: 120,
      singlePromptMax: 10
    }
  }

  private resolveScheduleTemplate(project: Project, schedule: ProjectTaskSchedule): ProjectTaskTemplate | null {
    if (!schedule.templateId) return null
    return resolveProjectTaskSettings(project.config).templates.find((item) => item.id === schedule.templateId) || null
  }

  private resolveScheduleOccurrence(schedule: ProjectTaskSchedule, now = new Date()): {
    automationSuffix: string
    scheduledAt: string
  } | null {
    return resolveScheduleOccurrence(schedule, now)
  }

  private async enqueueProjectSchedule(
    project: Project,
    schedule: ProjectTaskSchedule,
    options?: {
      manual?: boolean
      now?: Date
    }
  ): Promise<PipelineRunRecord[]> {
    const now = options?.now || new Date()
    const occurrence = options?.manual
      ? {
        automationSuffix: `manual:${now.toISOString()}`,
        scheduledAt: undefined
      }
      : this.resolveScheduleOccurrence(schedule, now)
    if (!occurrence) return []

    const template = this.resolveScheduleTemplate(project, schedule)
    const defaults = {
      ...DEFAULT_PROJECT_TASK_DEFAULTS,
      ...(project.config.taskDefaults || {})
    }
    const batchMode = template?.batchMode || defaults.defaultBatchMode
    const sortedEpisodes = [...new Set(schedule.episodeNumbers)].sort((a, b) => a - b)
    if (sortedEpisodes.length === 0) return []

    const batchId = uuid()
    const batchLabel = `${options?.manual ? '手动触发' : '自动化'} · ${schedule.label}`
    let previousRootRunId: string | undefined
    const createdRuns: PipelineRunRecord[] = []

    for (const episodeNum of sortedEpisodes) {
      const automationKey = buildAutomationKey(project.id, schedule.id, occurrence.automationSuffix, episodeNum)
      if (getPipelineRunByAutomationKey(automationKey)) {
        continue
      }

      const dependencyCondition: PipelineDependencyCondition = batchMode === 'sequential_on_success'
        ? 'on_success'
        : 'always'
      const run = await this.enqueue({
        projectId: project.id,
        projectPath: project.projectPath,
        episodeNum,
        projectContext: this.buildProjectRuntimeContext(project, episodeNum),
        startStage: template?.startStage,
        singleStage: template?.startStage ? !!template.singleStage : false,
        strategy: {
          batchId,
          batchLabel,
          priority: template?.priority || defaults.defaultPriority,
          maxAutoRetries: template?.maxAutoRetries ?? defaults.defaultMaxAutoRetries,
          templateId: template?.id,
          templateLabel: template?.label
        },
        orchestration: {
          dependsOnRootRunId: batchMode === 'independent' ? undefined : previousRootRunId,
          condition: dependencyCondition,
          scheduledAt: occurrence.scheduledAt,
          scheduleId: schedule.id,
          scheduleLabel: schedule.label,
          automationKey
        }
      })

      createdRuns.push(run)
      if (batchMode !== 'independent') {
        previousRootRunId = run.rootRunId
      }
    }

    if (createdRuns.length > 0) {
      const alerts = {
        ...DEFAULT_PROJECT_TASK_ALERTS,
        ...(project.config.taskAlerts || {})
      }
      if (alerts.notifyOnScheduleTriggered) {
        this.sendAutomationAlert({
          type: 'schedule_triggered',
          projectId: project.id,
          projectPath: project.projectPath,
          projectName: project.name,
          title: `${options?.manual ? '计划已手动触发' : '自动化计划已触发'} · ${schedule.label}`,
          message: `已为 ${createdRuns.length} 集创建任务，批次「${batchLabel}」进入策略队列`,
          scheduleId: schedule.id,
          scheduleLabel: schedule.label,
          templateId: template?.id,
          templateLabel: template?.label,
          toastNotifications: alerts.toastNotifications,
          desktopNotifications: alerts.desktopNotifications,
          createdAt: new Date().toISOString()
        })
      }
    }

    return createdRuns
  }

  private async processAutomationSchedules(): Promise<void> {
    if (this.automationSweepRunning) return

    this.automationSweepRunning = true
    try {
      await this.ensureQueueReady()

      for (const project of listProjects()) {
        for (const schedule of project.config.taskSchedules || []) {
          if (!schedule.enabled) continue
          await this.enqueueProjectSchedule(project, schedule)
        }
      }
      this.lastAutomationScanAt = new Date().toISOString()
      this.lastAutomationScanError = undefined
    } catch (error) {
      this.lastAutomationScanAt = new Date().toISOString()
      this.lastAutomationScanError = error instanceof Error
        ? error.message
        : '自动化扫描失败，请检查项目配置与数据库状态'
      // 自动化扫描失败不应影响手动队列
    } finally {
      this.automationSweepRunning = false
    }
  }

  private buildQueueSnapshot(meta: QueueRunMeta): PipelineQueueSnapshot {
    return {
      runId: meta.runId,
      rootRunId: meta.strategy.rootRunId,
      projectId: meta.params.projectId,
      projectPath: meta.params.projectPath,
      episodeNum: meta.params.episodeNum,
      currentStage: meta.params.startStage || 'director',
      priority: meta.strategy.priority,
      queuePosition: meta.queuePosition,
      scheduledAt: meta.orchestration.scheduledAt,
      dependsOnRootRunId: meta.orchestration.dependsOnRootRunId,
      scheduleLabel: meta.orchestration.scheduleLabel,
      templateLabel: meta.strategy.templateLabel
    }
  }

  private buildRuntimeIssues(projects: Project[]): PipelineRuntimeIssue[] {
    const configIssues = projects.flatMap((project) =>
      validateProjectTaskAutomation(project.config, project.totalEpisodes).map((issue) => ({
        severity: issue.severity,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.projectPath,
        scope: issue.scope,
        field: issue.field,
        message: issue.message,
        id: issue.id
      }))
    )

    const projectNameById = new Map(projects.map((project) => [project.id, project.name]))
    const recoveryIssues = listRecoverablePipelineRuns()
      .filter((run) => run.status === 'dead_letter')
      .slice(0, 12)
      .map((run) => ({
        severity: 'error' as const,
        projectId: run.projectId,
        projectName: projectNameById.get(run.projectId) || run.projectId,
        projectPath: run.projectPath,
        scope: 'recovery' as const,
        field: 'deadLetter',
        message: run.recoveryNote || run.errorMessage || `EP${String(run.episodeNum).padStart(3, '0')} 任务已进入死信`,
        id: run.runId
      }))

    return [...configIssues, ...recoveryIssues]
  }

  private dependencyMatches(condition: PipelineDependencyCondition, status: PipelineRunStatus): boolean {
    if (condition === 'always') return ['completed', 'failed', 'aborted', 'dead_letter'].includes(status)
    if (condition === 'on_success') return status === 'completed'
    return status === 'failed' || status === 'aborted' || status === 'dead_letter'
  }

  private resolveQueuedRun(meta: QueueRunMeta): { action: 'run' | 'wait' | 'skip'; nextAt?: string; reason?: string } {
    if (meta.orchestration.scheduledAt) {
      const scheduledMs = new Date(meta.orchestration.scheduledAt).getTime()
      if (Number.isFinite(scheduledMs) && scheduledMs > Date.now()) {
        return { action: 'wait', nextAt: meta.orchestration.scheduledAt }
      }
    }

    if (meta.orchestration.dependsOnRootRunId) {
      const dependency = getLatestPipelineRunByRootRunId(meta.orchestration.dependsOnRootRunId)
      if (!dependency) {
        return { action: 'skip', reason: '依赖任务不存在，无法释放执行' }
      }

      if (dependency.status === 'queued' || dependency.status === 'running' || dependency.status === 'paused') {
        return { action: 'wait' }
      }

      if (!this.dependencyMatches(meta.orchestration.condition, dependency.status)) {
        return {
          action: 'skip',
          reason: `依赖条件未满足：前置任务结果为 ${dependency.status}`
        }
      }
    }

    return { action: 'run' }
  }

  private skipQueuedRun(meta: QueueRunMeta, reason: string): void {
    const now = new Date().toISOString()
    upsertPipelineRun({
      ...this.makeQueuedRecord(meta),
      status: 'aborted',
      endedAt: now,
      lastUpdatedAt: now,
      queuePosition: undefined,
      errorMessage: reason
    })
  }

  private launchRun(meta: QueueRunMeta): Promise<void> {
    this.currentRun = meta
    this.activeRun = this.makeActiveRunPlaceholder(meta)
    this.launchingQueuedRun = false

    const startedAt = new Date().toISOString()
    upsertPipelineRun({
      ...this.makeQueuedRecord(meta),
      status: 'running',
      startedAt,
      lastUpdatedAt: startedAt,
      queuePosition: undefined,
      workerSlot: 1,
      deadLetteredAt: undefined,
      recoveryNote: undefined
    })
    this.startHeartbeat(meta.runId)

    const runPromise = (async () => {
      try {
        const params = {
          ...meta.params,
          projectContext: this.buildProjectContext(meta.params)
        }
        this.configureEngine(params)
        await this.getEngine().start({
          ...params,
          runId: meta.runId
        })
        this.activeRun = toActiveRun(this.getEngine().getContext())
      } catch (error) {
        this.stopHeartbeat()
        const message = error instanceof Error ? error.message : String(error)
        const failedAt = new Date().toISOString()
        upsertPipelineRun({
          ...this.makeQueuedRecord(meta),
          status: 'failed',
          startedAt,
          endedAt: failedAt,
          lastUpdatedAt: failedAt,
          queuePosition: undefined,
          errorMessage: message
        })
        this.send(IPC.PIPELINE_ERROR, { message, error: message })
        this.finalizeCurrentRun({
          ...this.makeQueuedRecord(meta),
          status: 'failed',
          startedAt,
          endedAt: failedAt,
          lastUpdatedAt: failedAt,
          queuePosition: undefined,
          errorMessage: message,
          workerSlot: 1
        })
      }
    })()

    return runPromise
  }

  private kickQueue(): void {
    if (!this.queueRestoreFinished || this.launchingQueuedRun || this.hasRunningEngine()) {
      return
    }

    let nextWakeAt: string | undefined

    for (let index = 0; index < this.queuedRuns.length; index++) {
      const candidate = this.queuedRuns[index]
      const resolution = this.resolveQueuedRun(candidate)

      if (resolution.action === 'skip') {
        this.queuedRuns.splice(index, 1)
        this.skipQueuedRun(candidate, resolution.reason || '依赖条件未满足')
        index -= 1
        continue
      }

      if (resolution.action === 'wait') {
        if (resolution.nextAt && (!nextWakeAt || resolution.nextAt < nextWakeAt)) {
          nextWakeAt = resolution.nextAt
        }
        continue
      }

      this.queuedRuns.splice(index, 1)
      this.rebuildQueuePositions()
      this.launchingQueuedRun = true
      this.scheduleQueueWake()
      void this.launchRun(candidate)
      return
    }

    this.rebuildQueuePositions()
    this.scheduleQueueWake(nextWakeAt)
  }

  private attach(engine: PipelineStateMachine): void {
    engine.on('stateChanged', (data: { context: PipelineContext }) => {
      this.flushPendingStreamBroadcast()
      if (data.context.runId) {
        touchPipelineRunHeartbeat(data.context.runId, data.context.lastUpdatedAt || new Date().toISOString())
      }
      this.activeRun = toActiveRun(data.context)
      const meta = this.currentRun?.runId === data.context.runId
        ? this.currentRun
        : undefined
      const record = toRunRecord(data.context, meta)
      if (record) {
        upsertPipelineRun(record)
      }

      if (record && !shouldKeepActiveRun(data.context.state)) {
        this.finalizeCurrentRun(record)
      }

      this.send(IPC.PIPELINE_STATE_CHANGED, data)
    })
    engine.on('log', (data) => {
      this.flushPendingStreamBroadcast()
      const runId = this.currentRun?.runId || this.getEngine().getContext().runId
      if (runId) {
        savePipelineRunLog(runId, data)
        touchPipelineRunHeartbeat(runId, data.timestamp || new Date().toISOString())
      }
      this.send(IPC.PIPELINE_LOG, data)
    })
    engine.on('stream', (data) => {
      const runId = this.currentRun?.runId || this.getEngine().getContext().runId
      if (runId) {
        touchPipelineRunHeartbeat(runId)
      }
      this.queueStreamBroadcast(data)
    })
    engine.on('llmTelemetry', (data) => {
      const runId = this.currentRun?.runId || this.getEngine().getContext().runId
      if (runId) {
        savePipelineRunLLMCall(runId, {
          stage: data.stage,
          phase: data.phase,
          provider: data.provider,
          model: data.model,
          status: data.status,
          stream: data.stream,
          startedAt: data.startedAt,
          endedAt: data.endedAt,
          durationMs: data.durationMs,
          usage: data.usage,
          estimatedCostUsd: data.estimatedCostUsd,
          failureClass: data.failureClass,
          errorMessage: data.errorMessage
        })
        touchPipelineRunHeartbeat(runId, data.endedAt || new Date().toISOString())
      }
    })
    engine.on('stageComplete', (data) => this.send(IPC.PIPELINE_STAGE_COMPLETE, data))
    engine.on('reviewResult', (data) => this.send(IPC.PIPELINE_REVIEW_RESULT, data))
    engine.on('error', (data) => this.send(IPC.PIPELINE_ERROR, data))
  }

  getEngine(): PipelineStateMachine {
    if (!this.engine) {
      this.engine = new PipelineStateMachine(getSkillsDir())
      this.attach(this.engine)
    }
    return this.engine
  }

  isBusy(): boolean {
    return this.hasRunningEngine()
  }

  getActiveRun(): PipelineActiveRun | null {
    return this.activeRun
  }

  listRuns(projectId: string, limit = 20, includeArchived = false): PipelineRunRecord[] {
    return listPipelineRuns(projectId, limit, includeArchived)
  }

  listAllRuns(limit = 100, includeArchived = false): PipelineRunRecord[] {
    return listAllPipelineRuns(limit, includeArchived)
  }

  getRunDetail(runId: string): PipelineRunDetail | null {
    return getPipelineRunDetail(runId)
  }

  archiveFinishedRuns(olderThanDays: number, projectId?: string): number {
    return archivePipelineRuns(olderThanDays, projectId)
  }

  private async runRecoverySweep(options?: { startup?: boolean }): Promise<void> {
    try {
      const recoverableRuns = listRecoverablePipelineRuns()
      const queuedRunIds = new Set(this.queuedRuns.map((run) => run.runId))
      let orphanedCount = 0

      for (const run of recoverableRuns) {
        if (run.status === 'dead_letter') continue

        if (run.status === 'queued') {
          if (queuedRunIds.has(run.runId) || this.currentRun?.runId === run.runId) {
            continue
          }

          const payload = getPipelineRunPayload(run.runId)
          const restored = this.hydrateQueuedRun(run, payload)
          if (restored) {
            this.queuedRuns.push(restored)
            queuedRunIds.add(restored.runId)
            orphanedCount += 1
          } else {
            orphanedCount += 1
          }
          continue
        }

        const isLiveRun = this.currentRun?.runId === run.runId || this.activeRun?.runId === run.runId
        if (isLiveRun) continue

        const lastUpdatedMs = new Date(run.lastUpdatedAt).getTime()
        const staleThreshold = run.status === 'paused' ? PAUSED_STALE_MS : RUN_STALE_MS
        const isStale = !Number.isFinite(lastUpdatedMs) || (Date.now() - lastUpdatedMs) >= staleThreshold

        if (options?.startup || isStale) {
          const reason = run.status === 'paused'
            ? '应用退出后暂停任务无法直接恢复，已转入死信，请重新入队。'
            : '应用退出或执行器异常中断，任务已转入死信，请重新入队。'
          markPipelineRunDeadLetter(run.runId, reason, {
            state: run.state === 'paused' ? 'paused' : 'error'
          })
          orphanedCount += 1
        }
      }

      if (orphanedCount > 0) {
        this.rebuildQueuePositions()
        this.kickQueue()
      }

      this.orphanedRunCount = orphanedCount
      this.lastRecoverySweepAt = new Date().toISOString()
      this.lastRecoverySweepError = undefined
    } catch (error) {
      this.lastRecoverySweepAt = new Date().toISOString()
      this.lastRecoverySweepError = error instanceof Error ? error.message : '运行恢复巡检失败'
    }
  }

  getDiagnostics(): PipelineRuntimeDiagnostics {
    const projects = listProjects()
    const queue = this.queuedRuns.map((item) => this.buildQueueSnapshot(item))
    const waitingForSchedule = queue.filter((item) => !!item.scheduledAt && new Date(item.scheduledAt).getTime() > Date.now()).length
    const waitingForDependency = queue.filter((item) => !!item.dependsOnRootRunId).length
    const deadLetterCount = listRecoverablePipelineRuns().filter((run) => run.status === 'dead_letter').length
    const telemetry = getPipelineRuntimeTelemetrySummary()

    return {
      generatedAt: new Date().toISOString(),
      activeRun: this.activeRun
        ? {
          runId: this.activeRun.runId,
          projectId: this.activeRun.projectId,
          projectPath: this.activeRun.projectPath,
          episodeNum: this.activeRun.episodeNum,
          currentStage: this.activeRun.currentStage,
          state: this.activeRun.state,
          startedAt: this.activeRun.startedAt
        }
        : null,
      queue,
      queueSummary: {
        total: queue.length,
        waitingForSchedule,
        waitingForDependency,
        deadLetter: deadLetterCount
      },
      automation: {
        projectCount: projects.length,
        enabledScheduleCount: projects.reduce(
          (count, project) => count + (project.config.taskSchedules || []).filter((item) => item.enabled).length,
          0
        ),
        lastScanAt: this.lastAutomationScanAt,
        lastScanError: this.lastAutomationScanError,
        nextQueueWakeAt: this.queueWakeAt
      },
      recovery: {
        deadLetterCount,
        orphanedRunCount: this.orphanedRunCount,
        lastSweepAt: this.lastRecoverySweepAt,
        lastSweepError: this.lastRecoverySweepError
      },
      telemetry,
      issues: this.buildRuntimeIssues(projects)
    }
  }

  async triggerRecoverySweep(): Promise<PipelineRuntimeDiagnostics> {
    await this.ensureQueueReady()
    await this.runRecoverySweep()
    return this.getDiagnostics()
  }

  async triggerAutomationScan(): Promise<PipelineRuntimeDiagnostics> {
    await this.processAutomationSchedules()
    return this.getDiagnostics()
  }

  async triggerProjectSchedule(projectId: string, scheduleId: string): Promise<PipelineRunRecord[]> {
    await this.ensureQueueReady()

    const project = listProjects().find((item) => item.id === projectId)
    if (!project) {
      throw new Error('找不到项目')
    }

    const schedule = (project.config.taskSchedules || []).find((item) => item.id === scheduleId)
    if (!schedule) {
      throw new Error('找不到自动化计划')
    }

    return this.enqueueProjectSchedule(project, schedule, { manual: true })
  }

  async retryRun(runId: string): Promise<PipelineRunRecord> {
    await this.ensureQueueReady()

    const payload = getPipelineRunPayload(runId)
    if (!payload) {
      throw new Error('找不到该任务的重试参数')
    }

    const projectId = typeof payload.projectId === 'string' ? payload.projectId : null
    const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath : null
    const episodeNum = typeof payload.episodeNum === 'number' ? payload.episodeNum : null
    const projectContext = typeof payload.projectContext === 'object' && payload.projectContext
      ? payload.projectContext as ProjectContext
      : null
    const startStage = typeof payload.startStage === 'string' ? payload.startStage as PipelineStage : undefined
    const singleStage = typeof payload.singleStage === 'boolean' ? payload.singleStage : undefined
    const strategy = typeof payload.strategy === 'object' && payload.strategy
      ? payload.strategy as Partial<PipelineTaskStrategy>
      : undefined
    const orchestration = typeof payload.orchestration === 'object' && payload.orchestration
      ? payload.orchestration as Partial<PipelineTaskOrchestration>
      : undefined

    if (!projectId || !projectPath || !episodeNum || !projectContext) {
      throw new Error('任务重试参数不完整')
    }

    return this.enqueue({
      projectId,
      projectPath,
      episodeNum,
      projectContext,
      startStage,
      singleStage,
      strategy: {
        ...strategy,
        attempt: Math.max(0, Number(strategy?.attempt ?? 0)) + 1
      },
      orchestration
    })
  }

  async enqueue(params: PipelineStartParams): Promise<PipelineRunRecord> {
    await this.ensureQueueReady()

    const meta = this.createQueueMeta(params)

    const record = this.persistQueuedRun(meta)
    this.queuedRuns.push(meta)
    this.rebuildQueuePositions()
    this.kickQueue()
    return this.makeQueuedRecord(this.queuedRuns.find((item) => item.runId === meta.runId) || meta)
  }

  async start(params: PipelineStartParams): Promise<void> {
    await this.ensureQueueReady()
    if (params.orchestration?.dependsOnRootRunId || params.orchestration?.scheduledAt) {
      await this.enqueue(params)
      return
    }
    if (this.hasPendingWork()) {
      throw new Error('流水线正在执行或队列中仍有任务，请等待当前任务系统处理完成')
    }

    const meta = this.createQueueMeta(params)
    this.launchingQueuedRun = true
    this.launchRun(meta).catch(console.error)
  }

  async runAndWait(params: PipelineStartParams): Promise<{ state: PipelineState; stage: PipelineStage }> {
    await this.ensureQueueReady()
    if (params.orchestration?.dependsOnRootRunId || params.orchestration?.scheduledAt) {
      throw new Error('带依赖或定时条件的任务请使用入队模式，不支持同步等待')
    }
    if (this.hasPendingWork()) {
      throw new Error('流水线正在执行或队列中仍有任务，请等待当前任务系统处理完成')
    }

    const meta = this.createQueueMeta(params)

    this.launchingQueuedRun = true
    const engine = this.getEngine()
    const runPromise = this.launchRun(meta)
    await runPromise
    return { state: engine.getContext().state, stage: engine.getContext().currentStage }
  }

  async cancelRun(runId: string): Promise<boolean> {
    await this.ensureQueueReady()

    const queuedIndex = this.queuedRuns.findIndex((item) => item.runId === runId)
    if (queuedIndex >= 0) {
      this.queuedRuns.splice(queuedIndex, 1)
      cancelQueuedPipelineRun(runId)
      this.rebuildQueuePositions()
      this.kickQueue()
      return true
    }

    if (this.currentRun?.runId === runId) {
      await this.abort({ runId, reason: '任务已停止' })
      return true
    }

    return false
  }

  pause(): void {
    this.getEngine().pause()
    this.activeRun = toActiveRun(this.getEngine().getContext())
  }

  async abort(scope?: { runId?: string; batchId?: string; reason?: string }): Promise<{ abortedCurrent: boolean; cancelledQueued: number }> {
    await this.ensureQueueReady()

    const reason = scope?.reason || (scope?.batchId ? '批次已停止' : '任务已停止')
    const cancelledQueued = this.cancelQueuedRuns((item) => {
      if (scope?.runId) return item.runId === scope.runId
      if (scope?.batchId) return item.strategy.batchId === scope.batchId
      return false
    }, reason)

    const shouldAbortCurrent = !!this.currentRun && (
      (!scope?.runId || this.currentRun.runId === scope.runId) &&
      (!scope?.batchId || this.currentRun.strategy.batchId === scope.batchId)
    )

    this.stopHeartbeat()
    if (shouldAbortCurrent) {
      this.getEngine().abort(reason)
      this.activeRun = null
    } else if (cancelledQueued > 0) {
      this.kickQueue()
    }

    return {
      abortedCurrent: shouldAbortCurrent,
      cancelledQueued
    }
  }

  resume(): void {
    this.getEngine().resume()
    this.activeRun = toActiveRun(this.getEngine().getContext())
  }

  retry(stage?: PipelineStage): Promise<void> {
    const promise = this.getEngine().retry(stage)
    this.activeRun = toActiveRun(this.getEngine().getContext())
    return promise
  }

  skipReview(stage?: PipelineStage): void {
    const context = this.getEngine().getContext()
    this.getEngine().skipReview(stage || context.currentStage)
    this.activeRun = toActiveRun(this.getEngine().getContext())
  }

  setPipelineSettings(settings: Partial<PipelineSettings>): void {
    this.getEngine().setPipelineSettings(settings)
  }

  getContext(): PipelineContext {
    return this.getEngine().getContext()
  }

  async getContextForProject(projectPath?: string): Promise<PipelineContext> {
    const liveContext = this.getContext()
    const liveRun = toActiveRun(liveContext)

    if (liveRun && (!projectPath || liveRun.projectPath === projectPath)) {
      return liveContext
    }

    if (projectPath) {
      const persistedState = await readProjectStateFile(projectPath)
      const recovered = recoverPipelineContext(persistedState)
      if (recovered) {
        return recovered
      }
    }

    return liveContext
  }
}
