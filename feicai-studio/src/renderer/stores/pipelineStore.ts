// ============================================================
// Pipeline Store — 流水线状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import { IPC } from '@shared/ipc-channels'
import type {
  PipelineState,
  PipelineStage,
  PipelineContext,
  LogEntry,
  ReviewResult
} from '@shared/types'

interface StageTiming {
  stage: PipelineStage
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
  currentStageName: PipelineStage | null

  // Actions
  startPipeline: (params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
  }) => Promise<{ error?: string }>
  pausePipeline: () => Promise<void>
  stopPipeline: () => Promise<void>
  retryPipeline: (stage?: PipelineStage) => Promise<void>
  skipReviewPipeline: () => Promise<void>
  clearLogs: () => void
  resetDisplay: () => void
  syncFromBackend: () => Promise<void>
  setupEventListeners: () => () => void
}

function detectStage(state: PipelineState): PipelineStage | null {
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

function _registerListeners(set: Function, get: Function): () => void {
  const unsubscribers: Array<() => void> = []

  // 状态变更 + 计时
  unsubscribers.push(
    window.feicaiAPI.on(IPC.PIPELINE_STATE_CHANGED, (data: unknown) => {
      const { newState, context } = data as { newState: PipelineState; context: PipelineContext }
      const isTerminal = ['idle', 'paused', 'error', 'episode_complete'].includes(newState)
      const isRunning = !isTerminal
      const now = Date.now()
      const store = get()

      // 新一集开始时（script_loaded）或新阶段执行开始时（*_executing）清空 streamBuffer
      const isExecuting = (newState as string).endsWith('_analyzing') ||
        (newState as string).endsWith('_designing') ||
        (newState as string).endsWith('_writing')
      const resetStream = newState === 'script_loaded' || isExecuting

      // 检测阶段变化
      const newStage = detectStage(newState)
      let stageTimings = [...store.stageTimings]

      // 如果进入新阶段
      if (newStage && newStage !== store.currentStageName) {
        // 结束上一个阶段的计时
        if (store.currentStageName) {
          stageTimings = stageTimings.map(t =>
            t.stage === store.currentStageName && !t.endedAt
              ? { ...t, endedAt: now, elapsed: Math.round((now - t.startedAt) / 1000) }
              : t
          )
        }
        // 检查是否已有这个阶段的 timing（重试场景）
        const existing = stageTimings.find(t => t.stage === newStage && !t.endedAt)
        if (!existing) {
          stageTimings.push({ stage: newStage, startedAt: now, elapsed: 0 })
        }
      }

      // 如果流程结束
      if (['episode_complete', 'error'].includes(newState) && store.currentStageName) {
        stageTimings = stageTimings.map(t =>
          t.stage === store.currentStageName && !t.endedAt
            ? { ...t, endedAt: now, elapsed: Math.round((now - t.startedAt) / 1000) }
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
        // 延迟导入避免循环依赖
        const { useProjectStore } = require('@renderer/stores/projectStore')
        useProjectStore.getState().syncEpisodeStatus()
      }
    })
  )

  // 日志（上限 500 条，防止长期批量运行内存增长）
  const MAX_LOGS = 500
  unsubscribers.push(
    window.feicaiAPI.on(IPC.PIPELINE_LOG, (entry: unknown) => {
      set((s: PipelineStore) => {
        const newLogs = [...s.logs, entry as LogEntry]
        // 超出上限时裁剪最早的日志
        if (newLogs.length > MAX_LOGS) {
          return { logs: newLogs.slice(newLogs.length - MAX_LOGS) }
        }
        return { logs: newLogs }
      })
    })
  )

  // 流式输出
  unsubscribers.push(
    window.feicaiAPI.on(IPC.PIPELINE_STREAM, (data: unknown) => {
      const { chunk } = data as { chunk: string }
      set((s: PipelineStore) => ({ streamBuffer: s.streamBuffer + chunk }))
    })
  )

  // 审核结果
  unsubscribers.push(
    window.feicaiAPI.on(IPC.PIPELINE_REVIEW_RESULT, (data: unknown) => {
      const { result } = data as { result: ReviewResult }
      set({ currentReview: result })
    })
  )

  // 错误
  unsubscribers.push(
    window.feicaiAPI.on(IPC.PIPELINE_ERROR, () => {
      set({ isRunning: false })
    })
  )

  return () => {
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
      logs: [], streamBuffer: '', isRunning: true, state: 'script_loaded',
      pipelineStartedAt: now, stageTimings: [], currentStageName: null
    })
    const result = await window.feicaiAPI.invoke(IPC.PIPELINE_START, params) as { error?: string }
    if (result.error) {
      set({ isRunning: false, state: 'idle', pipelineStartedAt: null })
    }
    return result
  },

  pausePipeline: async () => {
    await window.feicaiAPI.invoke(IPC.PIPELINE_PAUSE)
  },

  stopPipeline: async () => {
    await window.feicaiAPI.invoke(IPC.PIPELINE_ABORT)
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
    await window.feicaiAPI.invoke(IPC.PIPELINE_RETRY, stage)
  },

  skipReviewPipeline: async () => {
    await window.feicaiAPI.invoke(IPC.PIPELINE_SKIP)
  },

  clearLogs: () => set({ logs: [], streamBuffer: '' }),

  /** 重置 UI 显示状态（切换集数时使用），不中断后台运行 */
  resetDisplay: () => set({
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
      const ctx = await window.feicaiAPI.invoke(IPC.PIPELINE_GET_STATE) as PipelineContext
      const isTerminal = ['idle', 'paused', 'error', 'episode_complete'].includes(ctx.state)
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
