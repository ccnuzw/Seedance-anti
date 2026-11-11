// ============================================================
// Pipeline State Machine — FEICAI 工作流状态机引擎
// ============================================================
//
// 状态图:
//   idle → script_loaded → director_analyzing → director_reviewing
//     → (PASS) director_done → art_designing → art_reviewing
//     → (PASS) art_done → storyboard_writing → storyboard_reviewing
//     → (PASS) episode_complete
//

import { ProjectStatePersistence } from './project-state'
//   任何 reviewing 状态:
//     → (FAIL) 回退到对应的 executing 状态（自动重试）
//
//   任何执行中状态:
//     → 可 PAUSE → paused → RESUME 回到之前状态
//     → 出错 → error
//

import { EventEmitter } from 'events'
import type {
  AutomatedPipelineStage,
  PipelineState,
  PipelineContext,
  ReviewResult,
  LogEntry,
  LLMConfig,
  PipelineSettings,
  ProjectConfig
} from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import { type ProjectContext } from './prompt-assembler'
import { createProvider } from '../llm/provider-factory'
import type { ILLMProvider } from '../llm/types'
import { v4 as uuid } from 'uuid'
import { randomUUID } from 'crypto'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import { WorkflowEngine } from '../workflow/workflow-engine'
import {
  createResetContext,
  finalizeSingleStageRun,
  performSkipReview,
  preparePipelineStart
} from './state-machine-lifecycle'
import {
  performPause,
  performResume,
  shouldStopPipelineExecution
} from './state-machine-controls'
import { handleReviewCycleResult } from './state-machine-review-cycle'
import {
  runStageGeneration,
  runStageReview
} from './state-machine-stage-runner'

export class PipelineStateMachine extends EventEmitter {
  private context: PipelineContext
  private workflowEngine: WorkflowEngine
  private llmProvider: ILLMProvider | null = null
  private pausedState: PipelineState | null = null
  private projectContext: ProjectContext | null = null
  private statePersistence: ProjectStatePersistence | null = null
  private pipelineSettings: PipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS }
  private _aborted = false
  private _reviewSkipped = false
  private projectConfig: Partial<ProjectConfig> | null = null
  private activeTask: Promise<void> | null = null
  private controller: AbortController | null = null
  private runId = ''
  private operationId?: string
  private pauseGate: Promise<void> | null = null
  private openPauseGate: (() => void) | null = null
  private externalCheckpoint?: () => Promise<void>
  private pendingErrorWrite: Promise<void> | null = null
  private pendingSkipWrite: Promise<void> | null = null

  isRunning(): boolean {
    return this.activeTask !== null
  }

  private async checkpoint(): Promise<void> {
    this.controller?.signal.throwIfAborted()
    if (this.pauseGate) await this.pauseGate
    await this.externalCheckpoint?.()
    this.controller?.signal.throwIfAborted()
  }

  constructor(skillsDir: string) {
    super()
    this.workflowEngine = new WorkflowEngine(skillsDir)

    this.context = {
      projectId: '',
      projectPath: '',
      episodeNum: 0,
      currentStage: 'director',
      state: 'idle',
      retryCount: 0,
      reviews: [],
      logs: []
    }
  }

  /** 获取当前状态 */
  getState(): PipelineState {
    return this.context.state
  }

  /** 获取完整上下文 */
  getContext(): PipelineContext {
    return {
      ...this.context,
      runId: this.runId,
      running: this.isRunning(),
      reviews: [...this.context.reviews],
      logs: [...this.context.logs]
    }
  }

  /** 设置 LLM Provider */
  setProvider(config: LLMConfig): void {
    if (this.activeTask) throw new Error('任务尚未结束，不能更换模型')
    this.llmProvider = createProvider(config)
    this.workflowEngine.setProvider(this.llmProvider)
  }

  /** 设置项目级流水线参数 */
  setPipelineSettings(settings: Partial<PipelineSettings>): void {
    this.pipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS, ...settings }
  }

  // ==================== 状态转换 ====================

  private setState(newState: PipelineState): void {
    const oldState = this.context.state
    this.context.state = newState
    this.log('info', 'state_changed', `状态: ${oldState} → ${newState}`)
    this.emit('stateChanged', {
      oldState,
      newState,
      context: this.getContext()
    })
  }

  // ==================== 核心流程 ====================

  /**
   * 启动流水线 — 加载剧本并开始第一个阶段
   */
  start(params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectContext: ProjectContext
    projectConfig?: Partial<ProjectConfig> | null
    startStage?: AutomatedPipelineStage
    singleStage?: boolean
    signal?: AbortSignal
    runId?: string
    operationId?: string
    waitUntilResumed?: () => Promise<void>
  }): Promise<void> {
    if (this.activeTask) throw new Error('任务仍在执行或停止中')
    this.controller = new AbortController()
    this.runId = params.runId || randomUUID()
    this.operationId = params.operationId
    this.externalCheckpoint = params.waitUntilResumed
    const cancel = () => {
      this.controller?.abort()
      this.openPauseGate?.()
    }
    params.signal?.addEventListener('abort', cancel, { once: true })
    if (params.signal?.aborted) cancel()
    // Start on the next microtask: the active slot is held before the first await.
    const task = Promise.resolve()
      .then(() => this.executeStart(params))
      .catch(async (error) => {
        if (!this.controller?.signal.aborted)
          this.handleError('制作流程执行失败', error)
      })
      .finally(async () => {
        params.signal?.removeEventListener('abort', cancel)
        try {
          await this.pendingErrorWrite
          await this.pendingSkipWrite
        } finally {
          this.pendingErrorWrite = null
          this.pendingSkipWrite = null
          if (this._aborted || this.controller?.signal.aborted)
            this.context.state = 'idle'
          this.activeTask = null
          this.setState(this.context.state)
        }
      })
    this.activeTask = task
    return task
  }

  private async executeStart(
    params: Parameters<PipelineStateMachine['start']>[0]
  ): Promise<void> {
    await this.checkpoint()
    this.statePersistence = null
    const prepared = await preparePipelineStart({
      params,
      llmConfigured: this.llmProvider !== null,
      currentState: this.context.state,
      onResetFlags: () => {
        this._aborted = false
        this._reviewSkipped = false
        this.pausedState = null
      },
      onContextInitialized: (context) => {
        this.context = context
      },
      onProjectContextAssigned: (projectContext) => {
        this.projectContext = projectContext
      },
      onProjectConfigAssigned: (projectConfig) => {
        this.projectConfig = {
          ...projectConfig,
          pipelineSettings: { ...this.pipelineSettings }
        }
      },
      onStatePersistenceAssigned: (persistence) => {
        this.statePersistence = persistence
      },
      onLog: (level, eventType, message) => this.log(level, eventType, message),
      onStateChange: (state) => this.setState(state),
      onScriptPathAssigned: (scriptPath) => {
        this.context.scriptPath = scriptPath
      },
      onError: (message, error) => this.handleError(message, error)
    })

    if (!prepared) {
      return
    }

    for (const stage of prepared.stageSequence) {
      await this.checkpoint()
      if (this.shouldStop()) break
      await this.executeFullStage(stage)
    }

    if (params.singleStage && !this.shouldStop()) {
      finalizeSingleStageRun({
        startStage: params.startStage,
        shouldStop: () => this.shouldStop(),
        onLog: (level, eventType, message) =>
          this.log(level, eventType, message),
        onStateChange: (state) => this.setState(state)
      })
    }
  }

  /** 检查是否应该中止执行（暂停、出错、abort、或 idle） */
  private shouldStop(): boolean {
    return shouldStopPipelineExecution(this.context, this._aborted)
  }

  /**
   * 执行完整的单个阶段（执行 + 审核 + 可能的重试）
   */
  private async executeFullStage(stage: AutomatedPipelineStage): Promise<void> {
    this.context.currentStage = stage
    this.context.retryCount = 0
    this.context.lastReviewFeedback = undefined
    this._reviewSkipped = false
    const saved = this.statePersistence?.getEpisode(this.context.episodeNum)
      ?.stageStates[stage]
    if (
      this.operationId &&
      saved?.operationId === this.operationId &&
      saved.lastReview &&
      !saved.lastReview.passed
    ) {
      this.context.retryCount = Math.max(
        0,
        saved.attempts - (saved.status === 'running' ? 1 : 0)
      )
      this.context.lastReviewFeedback = saved.lastReview.feedback
      if (this.context.retryCount > this.pipelineSettings.maxRetries) {
        this.handleError(`${stage} 阶段审核失败超过最大重试次数`, null)
        return
      }
    }

    let passed = false
    while (
      !passed &&
      this.context.retryCount <= this.pipelineSettings.maxRetries
    ) {
      if (this.shouldStop()) return
      await this.checkpoint()

      // 1. 执行阶段
      await this.executeStage(stage)
      await this.checkpoint()
      if (this.shouldStop()) return

      // 2. 审核阶段
      const reviewResult = await this.executeReview(stage)
      await this.checkpoint()
      if (this.shouldStop()) return

      // 3. 如果审核被用户跳过（skipReview 设置了 _reviewSkipped），直接跳出
      if (this._reviewSkipped) {
        await this.pendingSkipWrite
        this._reviewSkipped = false
        passed = true
        break
      }

      const outcome = await handleReviewCycleResult({
        stage,
        reviewResult,
        episodeNum: this.context.episodeNum,
        retryCount: this.context.retryCount,
        maxRetries: this.pipelineSettings.maxRetries,
        statePersistence: this.statePersistence,
        operationId: this.operationId,
        getStageOutputPath: (targetStage) =>
          this.getStageOutputPath(targetStage),
        getStageReviewPath: (targetStage) =>
          this.getStageReviewPath(targetStage),
        onStateChange: (state) => this.setState(state as PipelineState),
        onLog: (level, eventType, message) =>
          this.log(level, eventType, message),
        onStageComplete: (payload) => this.emit('stageComplete', payload)
      })

      if (outcome.passed) {
        passed = true
        this.context.lastReviewFeedback = undefined
        continue
      }

      this.context.retryCount = outcome.nextRetryCount
      this.context.lastReviewFeedback = outcome.nextReviewFeedback

      if (outcome.exhausted) {
        this.handleError(
          outcome.exhaustedMessage || `${stage} 阶段审核失败`,
          null
        )
        return
      }
    }
  }

  /**
   * 执行单个阶段的生成任务
   */
  private async executeStage(stage: AutomatedPipelineStage): Promise<void> {
    await runStageGeneration({
      stage,
      operationId: this.operationId
        ? `${this.operationId}:generation:${stage}:${this.context.retryCount}`
        : undefined,
      signal: this.controller?.signal,
      waitUntilResumed: () => this.checkpoint(),
      workflowEngine: this.workflowEngine,
      projectPath: this.context.projectPath,
      episodeNum: this.context.episodeNum,
      projectContext: this.projectContext!,
      projectConfig: this.projectConfig,
      pipelineSettings: this.pipelineSettings,
      reviewFeedback: this.context.lastReviewFeedback,
      statePersistence: this.statePersistence,
      getStageOutputPath: (targetStage) => this.getStageOutputPath(targetStage),
      onStateChange: (state) => this.setState(state as PipelineState),
      onLog: (level, eventType, message) => this.log(level, eventType, message),
      onStream: (payload) =>
        this.emit('stream', { ...payload, runId: this.runId }),
      shouldStop: () => this.shouldStop(),
      onDirectorOutputPath: (path) => {
        this.context.directorAnalysisPath = path
      },
      onStoryboardOutputPath: (path) => {
        this.context.seedancePromptsPath = path
      },
      onError: (message, error) => this.handleError(message, error)
    })
  }

  /**
   * 执行审核
   */
  private async executeReview(
    stage: AutomatedPipelineStage
  ): Promise<ReviewResult | null> {
    return await runStageReview({
      stage,
      operationId: this.operationId
        ? `${this.operationId}:review:${stage}:${this.context.retryCount}`
        : undefined,
      signal: this.controller?.signal,
      waitUntilResumed: () => this.checkpoint(),
      workflowEngine: this.workflowEngine,
      projectPath: this.context.projectPath,
      episodeNum: this.context.episodeNum,
      scriptPath: this.context.scriptPath,
      projectConfig: this.projectConfig,
      onStateChange: (state) => this.setState(state as PipelineState),
      onLog: (level, eventType, message) => this.log(level, eventType, message),
      onReviewAppended: (review) => {
        this.context.reviews.push(review)
      },
      onReviewResult: (payload) =>
        this.emit('reviewResult', { ...payload, runId: this.runId }),
      onError: (message, error) => this.handleError(message, error)
    })
  }

  // ==================== 暂停/恢复/重试 ====================

  pause(): void {
    if (!this.activeTask || this.pauseGate) return
    const gate = Promise.withResolvers<void>()
    this.pauseGate = gate.promise
    this.openPauseGate = gate.resolve
    performPause({
      currentState: this.context.state,
      onPausedStateSaved: (state) => {
        this.pausedState = state
      },
      onStateChange: (state) => this.setState(state),
      onLog: (level, eventType, message) => this.log(level, eventType, message)
    })
  }

  /** 强制中止（用于停止执行）—— 状态回到 idle 而非 error */
  async abort(): Promise<void> {
    this._aborted = true
    this.controller?.abort()
    this.openPauseGate?.()
    this.pauseGate = null
    this.openPauseGate = null
    this.pausedState = null
    await this.activeTask
    this.context.error = undefined
    this.setState('idle')
  }

  resume(): void {
    this.openPauseGate?.()
    this.openPauseGate = null
    this.pauseGate = null
    performResume({
      currentState: this.context.state,
      pausedState: this.pausedState,
      onStateChange: (state) => this.setState(state),
      onPausedStateCleared: () => {
        this.pausedState = null
      },
      onLog: (level, eventType, message) => this.log(level, eventType, message)
    })
  }

  /**
   * 从指定阶段重试
   */
  async retry(
    stage?: AutomatedPipelineStage,
    options: {
      signal?: AbortSignal
      runId?: string
      waitUntilResumed?: () => Promise<void>
    } = {}
  ): Promise<void> {
    if (this.activeTask) throw new Error('任务尚未结束，不能重试')
    if (!this.projectContext) throw new Error('没有可重试的制作流程')
    await this.start({
      ...options,
      projectId: this.context.projectId,
      projectPath: this.context.projectPath,
      episodeNum: this.context.episodeNum,
      projectContext: this.projectContext,
      projectConfig: this.projectConfig,
      startStage: stage || this.context.currentStage
    })
  }

  /**
   * 跳过当前阶段审核，直接标记通过
   */
  async skipReview(stage: AutomatedPipelineStage): Promise<void> {
    if (!this.context.state.endsWith('_reviewing')) return
    this._reviewSkipped = true // 设置标志，阻止 executeFullStage 重试
    this.pendingSkipWrite = performSkipReview({
      stage,
      episodeNum: this.context.episodeNum,
      statePersistence: this.statePersistence,
      onLog: (level, eventType, message) => this.log(level, eventType, message),
      onStateChange: (state) => this.setState(state)
    })
    await this.pendingSkipWrite
  }

  /**
   * 等待流水线执行完成（episode_complete 或 error）
   * 用于批量模式的串行等待
   */
  async waitForCompletion(): Promise<{
    state: PipelineState
    stage: AutomatedPipelineStage
  }> {
    await this.activeTask
    return { state: this.context.state, stage: this.context.currentStage }
  }

  /** 重置到初始状态 */
  reset(): void {
    if (this.activeTask) throw new Error('任务尚未结束，不能重置')
    this.context = createResetContext()
    this.pausedState = null
    this._aborted = false
    this._reviewSkipped = false
    this.projectConfig = null
    this.setState('idle')
  }

  // ==================== 辅助 ====================

  private log(
    level: LogEntry['level'],
    eventType: string,
    message: string
  ): void {
    const entry: LogEntry = {
      id: uuid(),
      episodeId: `ep${String(this.context.episodeNum).padStart(2, '0')}`,
      stage: this.context.currentStage,
      level,
      eventType,
      message,
      timestamp: new Date().toISOString()
    }
    this.context.logs.push(entry)
    if (this.context.logs.length > 500)
      this.context.logs.splice(0, this.context.logs.length - 500)
    this.emit('log', { ...entry, runId: this.runId })
  }

  private handleError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error || '')
    this.log('error', 'error', `❌ ${message}${detail ? ': ' + detail : ''}`)
    this.context.error = `${message}${detail ? ': ' + detail : ''}`
    if (this.statePersistence && this.context.episodeNum > 0) {
      this.pendingErrorWrite = this.statePersistence.markStageError(
        this.context.episodeNum,
        this.context.currentStage,
        this.context.error
      )
      void this.pendingErrorWrite.catch(console.error)
    }
    this.setState('error')
    this.emit('error', { message, error: detail, runId: this.runId })
  }

  private getStageOutputPath(
    stage: AutomatedPipelineStage
  ): string | undefined {
    if (stage === 'director') return this.context.directorAnalysisPath
    if (stage === 'storyboard') return this.context.seedancePromptsPath
    if (stage === 'art') {
      return resolveEpisodeArtifactPath(
        this.context.projectPath,
        'artDesign',
        this.context.episodeNum,
        this.projectConfig
      )
    }
    return undefined
  }

  private getStageReviewPath(
    stage: AutomatedPipelineStage
  ): string | undefined {
    if (stage === 'storyboard') {
      return resolveEpisodeArtifactPath(
        this.context.projectPath,
        'storyboardReview',
        this.context.episodeNum,
        this.projectConfig
      )
    }
    return undefined
  }
}
