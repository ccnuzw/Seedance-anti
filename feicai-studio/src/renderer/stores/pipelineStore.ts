// ============================================================
// Pipeline Store — 流水线状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
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

interface StageTiming {
  stage: AutomatedPipelineStage
  startedAt: number
  endedAt?: number
  elapsed: number // seconds
}

interface PipelineStore {
  // 状态
  state: PipelineState
  context: PipelineContext | null
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
  set((s: PipelineStore) => ({ streamBuffer: s.streamBuffer + chunk }))
}

function _registerListeners(set: Function, get: Function): () => void {
  const unsubscribers: Array<() => void> = []

  // 状态变更 + 计时
  unsubscribers.push(
    pipelineEvents.onStateChanged((data: unknown) => {
      const { newState, context } = data as {
        newState: PipelineState
        context: PipelineContext
      }
      const isTerminal = [
        'idle',
        'paused',
        'error',
        'episode_complete'
      ].includes(newState)
      const isRunning = !isTerminal
      const now = Date.now()
      const store = get()

      // 新一集开始时（script_loaded）或新阶段执行开始时（*_executing）清空 streamBuffer
      const isExecuting =
        (newState as string).endsWith('_analyzing') ||
        (newState as string).endsWith('_designing') ||
        (newState as string).endsWith('_writing')
      const resetStream = newState === 'script_done' || isExecuting

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
        isRunning,
        stageTimings,
        currentStageName: newStage,
        ...(resetStream ? { streamBuffer: '' } : {})
      })

      // Pipeline 完成时自动刷新 episode 状态
      if (newState === 'episode_complete') {
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
      _pendingLogs.push(entry as LogEntry)
      if (_logFlushTimer) return
      _logFlushTimer = setTimeout(() => _flushPendingLogs(set), 80)
    })
  )

  // 流式输出
  unsubscribers.push(
    pipelineEvents.onStream((data: unknown) => {
      const { chunk } = data as { chunk: string }
      _pendingStreamChunks.push(chunk)
      if (_streamFlushTimer) return
      _streamFlushTimer = setTimeout(() => _flushPendingStream(set), 80)
    })
  )

  // 审核结果
  unsubscribers.push(
    pipelineEvents.onReviewResult((data: unknown) => {
      const { result } = data as { result: ReviewResult }
      set({ currentReview: result })
    })
  )

  // 错误
  unsubscribers.push(
    pipelineEvents.onError(() => {
      set({ isRunning: false, state: 'error' })
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
  logs: [],
  streamBuffer: '',
  isRunning: false,
  currentReview: null,

  pipelineStartedAt: null,
  stageTimings: [],
  currentStageName: null,

  startPipeline: async (params) => {
    const now = Date.now()
    set({
      logs: [],
      streamBuffer: '',
      isRunning: true,
      state: 'script_done',
      pipelineStartedAt: now,
      stageTimings: [],
      currentStageName: null
    })
    const result = await startPipeline(params)
    if (result.error) {
      set({ isRunning: false, state: 'idle', pipelineStartedAt: null })
    }
    return result
  },

  pausePipeline: async () => {
    await pausePipeline()
  },

  stopPipeline: async () => {
    await abortPipeline()
    // 立即完整重置 UI 状态，不等后端事件广播，避免闪烁
    set({
      isRunning: false,
      state: 'idle' as PipelineState,
      streamBuffer: ''
    })
  },

  retryPipeline: async (stage) => {
    const now = Date.now()
    // 重置计时器和 streamBuffer，确保数据准确
    set({
      isRunning: true,
      pipelineStartedAt: now,
      stageTimings: [],
      currentStageName: null,
      streamBuffer: ''
    })
    await retryPipeline(stage)
  },

  skipReviewPipeline: async () => {
    await skipPipeline()
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
  resetDisplay: () =>
    set({
      logs: [],
      streamBuffer: '',
      stageTimings: [],
      currentStageName: null,
      pipelineStartedAt: null,
      currentReview: null,
      state: 'idle',
      context: null,
      isRunning: false
    }),

  /** 从后端同步当前引擎状态到 store */
  syncFromBackend: async () => {
    try {
      const ctx = await getPipelineState()
      const isTerminal = [
        'idle',
        'paused',
        'error',
        'episode_complete'
      ].includes(ctx.state)
      set({
        state: ctx.state,
        context: ctx,
        isRunning: !isTerminal
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

    return () => {
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
