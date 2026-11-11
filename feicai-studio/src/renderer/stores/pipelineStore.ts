// ============================================================
// Pipeline Store — 流水线状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import { samePipelineRun } from '@shared/pipeline-task'
import type {
  PipelineControlTarget,
  PipelineRunIdentity
} from '@shared/pipeline-task'
import { useProjectStore } from '@renderer/stores/projectStore'
import {
  abortPipeline,
  getPipelineState,
  pausePipeline,
  pipelineEvents,
  retryPipeline,
  skipPipeline,
  startPipeline
} from '@renderer/services/pipeline-service'
import type {
  PipelineState,
  AutomatedPipelineStage,
  PipelineContext,
  LogEntry,
  ReviewResult
} from '@shared/types'

export interface StageTiming {
  stage: AutomatedPipelineStage
  startedAt: number
  endedAt?: number
  elapsed: number // seconds
}

interface PipelineStore {
  // 状态
  state: PipelineState
  context: PipelineContext | null
  runIdentity: PipelineRunIdentity | null
  logs: LogEntry[]
  streamBuffer: string
  isRunning: boolean
  currentReview: ReviewResult | null

  // 计时
  pipelineStartedAt: number | null
  stageTimings: StageTiming[]
  currentStageName: AutomatedPipelineStage | null

  // Actions
  startPipeline: (params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: AutomatedPipelineStage
    singleStage?: boolean
  }) => Promise<{ error?: string }>
  pausePipeline: () => Promise<void>
  stopPipeline: () => Promise<void>
  retryPipeline: (stage?: AutomatedPipelineStage) => Promise<void>
  skipReviewPipeline: () => Promise<void>
  clearLogs: () => void
  resetDisplay: () => void
  syncFromBackend: () => Promise<void>
  setupEventListeners: () => () => void
}

function detectStage(state: PipelineState): AutomatedPipelineStage | null {
  const s = state as string
  if (s.startsWith('director')) return 'director'
  if (s.startsWith('art')) return 'art'
  if (s.startsWith('storyboard')) return 'storyboard'
  return null
}

// ---- 引用计数事件监听 ----
// 页面切换时避免重复注册/意外取消
let _listenerRefCount = 0
let _syncEpoch = 0
let _cleanupFn: (() => void) | null = null
let _pendingLogs: LogEntry[] = []
let _pendingStreamChunks: string[] = []
let _logFlushTimer: ReturnType<typeof setTimeout> | null = null
let _streamFlushTimer: ReturnType<typeof setTimeout> | null = null

function _flushPendingLogs(set: Function): void {
  if (_pendingLogs.length === 0) {
    _logFlushTimer = null
    return
  }

  const entries = _pendingLogs
  _pendingLogs = []
  _logFlushTimer = null
  const MAX_LOGS = 500

  set((s: PipelineStore) => {
    const newLogs = [...s.logs, ...entries]
    if (newLogs.length > MAX_LOGS) {
      return { logs: newLogs.slice(newLogs.length - MAX_LOGS) }
    }
    return { logs: newLogs }
  })
}

function _flushPendingStream(set: Function): void {
  if (_pendingStreamChunks.length === 0) {
    _streamFlushTimer = null
    return
  }

  const chunk = _pendingStreamChunks.join('')
  _pendingStreamChunks = []
  _streamFlushTimer = null
  set((s: PipelineStore) => ({
    streamBuffer: (s.streamBuffer + chunk).slice(-200000)
  }))
}

function identityFromContext(
  context: PipelineContext | null
): PipelineRunIdentity | null {
  if (!context?.taskId || !context.runId) return null
  return {
    projectId: context.projectId,
    taskId: context.taskId,
    runId: context.runId,
    episodeNum: context.episodeNum,
    stage: context.currentStage
  }
}

function controlTarget(
  store: PipelineStore
): PipelineControlTarget | undefined {
  const identity = store.runIdentity ?? identityFromContext(store.context)
  const project = useProjectStore.getState().currentProject
  const projectId = identity?.projectId ?? store.context?.projectId
  if (project && projectId && projectId !== project.id)
    throw new Error('当前项目与制作任务不匹配')
  if (identity) return identity
  if (!store.context) throw new Error('没有可控制的制作任务')
  // Legacy backend compatibility, only until a run identity has been observed.
  return undefined
}

function acceptsEvent(store: PipelineStore, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const data = payload as {
    identity?: PipelineRunIdentity
    runId?: string
    context?: PipelineContext
  }
  const identity = data.identity ?? identityFromContext(data.context ?? null)
  const expected = store.runIdentity ?? identityFromContext(store.context)
  const project = useProjectStore.getState().currentProject
  const projectId = identity?.projectId ?? data.context?.projectId
  if (projectId && project && projectId !== project.id) return false
  if (expected) return !!identity && samePipelineRun(expected, identity)
  if (data.runId && store.context?.runId && data.runId !== store.context.runId)
    return false
  return true
}

function clearPendingEvents(): void {
  _pendingLogs = []
  _pendingStreamChunks = []
  if (_logFlushTimer) clearTimeout(_logFlushTimer)
  if (_streamFlushTimer) clearTimeout(_streamFlushTimer)
  _logFlushTimer = null
  _streamFlushTimer = null
}

function _registerListeners(set: Function, get: Function): () => void {
  const unsubscribers: Array<() => void> = []

  // Task announcements trigger an authoritative read, so a delayed announcement
  // cannot replace the current run with its stale payload.
  if (pipelineEvents.onTaskChanged) {
    unsubscribers.push(
      pipelineEvents.onTaskChanged((task) => {
        const project = useProjectStore.getState().currentProject
        if (
          task.kind === 'pipeline' &&
          task.status === 'running' &&
          (!project || project.id === task.identity.projectId) &&
          get().runIdentity?.runId !== task.identity.runId
        ) {
          void get().syncFromBackend()
        }
      })
    )
  }

  // 状态变更 + 计时
  unsubscribers.push(
    pipelineEvents.onStateChanged((data: unknown) => {
      if (!acceptsEvent(get(), data)) return
      const { newState, context } = data as {
        newState: PipelineState
        context: PipelineContext
      }
      const isTerminal = [
        'idle',
        'error',
        'episode_complete',
        'director_done',
        'art_done'
      ].includes(newState)
      const isRunning = context.running ?? !isTerminal
      const now = Date.now()
      const store = get()

      // 新一集开始时（script_loaded）或新阶段执行开始时（*_executing）清空 streamBuffer
      const isExecuting =
        (newState as string).endsWith('_analyzing') ||
        (newState as string).endsWith('_designing') ||
        (newState as string).endsWith('_writing')
      const resetStream = newState === 'script_done' || isExecuting
      if (
        resetStream ||
        (context.runId && context.runId !== store.context?.runId)
      ) {
        _pendingStreamChunks = []
        if (_streamFlushTimer) {
          clearTimeout(_streamFlushTimer)
          _streamFlushTimer = null
        }
      }

      // 检测阶段变化
      const newStage = detectStage(newState)
      let stageTimings = [...store.stageTimings]

      // 如果进入新阶段
      if (newStage && newStage !== store.currentStageName) {
        // 结束上一个阶段的计时
        if (store.currentStageName) {
          stageTimings = stageTimings.map((t) =>
            t.stage === store.currentStageName && !t.endedAt
              ? {
                  ...t,
                  endedAt: now,
                  elapsed: Math.round((now - t.startedAt) / 1000)
                }
              : t
          )
        }
        // 检查是否已有这个阶段的 timing（重试场景）
        const existing = stageTimings.find(
          (t) => t.stage === newStage && !t.endedAt
        )
        if (!existing) {
          stageTimings.push({ stage: newStage, startedAt: now, elapsed: 0 })
        }
      }

      // 如果流程结束
      if (
        ['episode_complete', 'error'].includes(newState) &&
        store.currentStageName
      ) {
        stageTimings = stageTimings.map((t) =>
          t.stage === store.currentStageName && !t.endedAt
            ? {
                ...t,
                endedAt: now,
                elapsed: Math.round((now - t.startedAt) / 1000)
              }
            : t
        )
      }

      set({
        state: newState,
        context,
        runIdentity: identityFromContext(context),
        isRunning,
        stageTimings,
        currentStageName: newStage,
        ...(resetStream ? { streamBuffer: '' } : {})
      })

      // Pipeline 完成时自动刷新 episode 状态
      const project = useProjectStore.getState().currentProject
      if (
        newState === 'episode_complete' &&
        (!project || project.id === context.projectId)
      ) {
        const episodeNum = context?.episodeNum
        if (episodeNum) {
          useProjectStore.getState().syncSingleEpisodeStatus(episodeNum)
        } else {
          useProjectStore.getState().syncEpisodeStatus()
        }
      }
    })
  )

  unsubscribers.push(
    pipelineEvents.onLog((entry: unknown) => {
      if (!acceptsEvent(get(), entry)) return
      _pendingLogs.push(entry as LogEntry)
      if (_logFlushTimer) return
      _logFlushTimer = setTimeout(() => _flushPendingLogs(set), 80)
    })
  )

  // 流式输出
  unsubscribers.push(
    pipelineEvents.onStream((data: unknown) => {
      if (!acceptsEvent(get(), data)) return
      const { chunk } = data as { chunk: string }
      _pendingStreamChunks.push(chunk)
      if (_streamFlushTimer) return
      _streamFlushTimer = setTimeout(() => _flushPendingStream(set), 80)
    })
  )

  // 审核结果
  unsubscribers.push(
    pipelineEvents.onReviewResult((data: unknown) => {
      if (!acceptsEvent(get(), data)) return
      const { result } = data as { result: ReviewResult }
      set({ currentReview: result })
    })
  )

  // 错误
  unsubscribers.push(
    pipelineEvents.onError((data: unknown) => {
      if (!acceptsEvent(get(), data)) return
      set({ state: 'error' })
    })
  )

  return () => {
    if (_logFlushTimer) {
      clearTimeout(_logFlushTimer)
      _flushPendingLogs(set)
    }
    if (_streamFlushTimer) {
      clearTimeout(_streamFlushTimer)
      _flushPendingStream(set)
    }
    for (const unsub of unsubscribers) unsub()
  }
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  state: 'idle',
  context: null,
  runIdentity: null,
  logs: [],
  streamBuffer: '',
  isRunning: false,
  currentReview: null,

  pipelineStartedAt: null,
  stageTimings: [],
  currentStageName: null,

  startPipeline: async (params) => {
    const now = Date.now()
    _syncEpoch++
    clearPendingEvents()
    set({
      context: null,
      runIdentity: null,
      currentReview: null,
      logs: [],
      streamBuffer: '',
      isRunning: true,
      state: 'script_done',
      pipelineStartedAt: now,
      stageTimings: [],
      currentStageName: null
    })
    try {
      const result = await startPipeline(params)
      if (result.identity) set({ runIdentity: result.identity })
      if (result.error)
        set({ isRunning: false, state: 'idle', pipelineStartedAt: null })
      return result
    } catch (error) {
      set({ isRunning: false, state: 'idle', pipelineStartedAt: null })
      throw error
    }
  },

  pausePipeline: async () => {
    await pausePipeline(controlTarget(get()))
  },

  stopPipeline: async () => {
    await abortPipeline(controlTarget(get()))
    // 立即完整重置 UI 状态，不等后端事件广播，避免闪烁
    set({
      isRunning: false,
      state: 'idle' as PipelineState,
      streamBuffer: ''
    })
  },

  retryPipeline: async (stage) => {
    const target = controlTarget(get())
    const now = Date.now()
    // 重置计时器和 streamBuffer，确保数据准确
    set({
      isRunning: true,
      pipelineStartedAt: now,
      stageTimings: [],
      currentStageName: null,
      streamBuffer: ''
    })
    try {
      await retryPipeline(stage, target)
      await get().syncFromBackend()
    } catch (error) {
      set({ isRunning: false })
      throw error
    }
  },

  skipReviewPipeline: async () => {
    await skipPipeline(controlTarget(get()))
  },

  clearLogs: () => {
    _pendingLogs = []
    _pendingStreamChunks = []
    if (_logFlushTimer) {
      clearTimeout(_logFlushTimer)
      _logFlushTimer = null
    }
    if (_streamFlushTimer) {
      clearTimeout(_streamFlushTimer)
      _streamFlushTimer = null
    }
    set({ logs: [], streamBuffer: '' })
  },

  /** 重置 UI 显示状态（切换集数时使用），不中断后台运行 */
  resetDisplay: () => {
    _syncEpoch++
    clearPendingEvents()
    set({
      logs: [],
      streamBuffer: '',
      stageTimings: [],
      currentStageName: null,
      pipelineStartedAt: null,
      currentReview: null,
      state: 'idle',
      context: null,
      runIdentity: null,
      isRunning: false
    })
  },

  /** 从后端同步当前引擎状态到 store */
  syncFromBackend: async () => {
    const epoch = ++_syncEpoch
    const projectId = useProjectStore.getState().currentProject?.id
    try {
      const ctx = await getPipelineState()
      if (
        epoch !== _syncEpoch ||
        projectId !== useProjectStore.getState().currentProject?.id
      )
        return
      const isTerminal = [
        'idle',
        'error',
        'episode_complete',
        'director_done',
        'art_done'
      ].includes(ctx.state)
      const project = useProjectStore.getState().currentProject
      if (project && ctx.projectId && ctx.projectId !== project.id) return
      const changedRun = get().runIdentity?.runId !== ctx.runId
      if (changedRun) clearPendingEvents()
      set({
        ...(changedRun
          ? {
              logs: [],
              streamBuffer: '',
              currentReview: null,
              stageTimings: [],
              currentStageName: null
            }
          : {}),
        state: ctx.state,
        context: ctx,
        runIdentity: identityFromContext(ctx),
        isRunning: ctx.running ?? !isTerminal
      })
    } catch {
      // 忽略
    }
  },

  setupEventListeners: () => {
    _listenerRefCount++
    if (_listenerRefCount === 1) {
      // 首次注册：创建真正的监听器
      _cleanupFn = _registerListeners(set, get)
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      _listenerRefCount--
      if (_listenerRefCount <= 0) {
        _listenerRefCount = 0
        if (_cleanupFn) {
          _cleanupFn()
          _cleanupFn = null
        }
      }
    }
  }
}))
