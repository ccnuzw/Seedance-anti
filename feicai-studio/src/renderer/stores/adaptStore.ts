// ============================================================
// Adapt Store — 编剧管线前端状态管理
// ============================================================

import { create } from 'zustand'
import { IPC } from '@shared/ipc-channels'
import type {
  AdaptState,
  AdaptContext,
  WaterLevel,
  NovelInfo,
  PlotPoint,
  LogEntry,
  LLMConfig,
  AdaptPlan,
  VolumePlan
} from '@shared/types'

interface StageReport {
  stage: string
  result?: unknown
  summary?: string
  batchNum?: number
  chapterRange?: [number, number]
  extractedPlots?: number
  episodeRange?: string
  episodeCount?: number
  waterLevel?: WaterLevel
}

interface AdaptStore {
  // 状态
  adaptState: AdaptState
  waterLevel: WaterLevel | null
  novelInfo: NovelInfo | null
  logs: LogEntry[]
  streamOutput: string
  isRunning: boolean
  error: string | null

  // 阶段报告
  lastStageReport: StageReport | null
  lastReviewResult: unknown | null

  // 操作
  initAdapt: (projectId: string, projectPath: string, llmConfig: LLMConfig) => Promise<void>
  startBreakdown: (batchCount?: number) => Promise<void>
  startScript: (batchCount?: number) => Promise<void>
  startAuto: () => Promise<void>
  pause: () => Promise<void>
  abort: () => Promise<void>
  fetchStatus: (projectPath: string) => Promise<void>
  clearStream: () => void
  clearLogs: () => void
  setupEventListeners: () => () => void

  // P1 新增
  initProject: (novelTitle: string, novelGenre: string, projectPath: string, llmConfig: LLMConfig) => Promise<void>
  reScript: (episodeNum: number) => Promise<void>
  fix: () => Promise<void>
  checkBreakdown: (batchNumber?: number) => Promise<void>
  smartNext: () => Promise<{ action: string; description: string } | undefined>

  // DA 新增
  revise: (episodeNum: number, revisionNotes: string) => Promise<void>
  breakdownAuto: () => Promise<void>
  scriptAuto: () => Promise<void>
  ensurePlan: () => Promise<void>

  // 改编规划
  adaptPlan: AdaptPlan | null
  loadPlan: (projectPath: string) => Promise<void>
  savePlan: (projectPath: string, plan: AdaptPlan) => Promise<void>
  generatePlan: (projectPath: string, volumePlan: VolumePlan, llmConfig: LLMConfig) => Promise<string>
}

// ---- 引用计数事件监听（与 pipelineStore 同架构）----
let _adaptListenerRefCount = 0
let _adaptCleanupFn: (() => void) | null = null
const MAX_ADAPT_LOGS = 500

function _registerAdaptListeners(set: Function, get: Function): () => void {
  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_STATE_CHANGED, ((...args: unknown[]) => {
      const data = args[0] as { newState: AdaptState; context: AdaptContext }
      set({
        adaptState: data.newState,
        waterLevel: data.context.waterLevel,
        isRunning: !['adapt_idle', 'adapt_error', 'adapt_paused', 'breakdown_done', 'script_done'].includes(data.newState)
      })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_LOG, ((...args: unknown[]) => {
      const entry = args[0] as LogEntry
      set((state: AdaptStore) => {
        const newLogs = [...state.logs, entry]
        if (newLogs.length > MAX_ADAPT_LOGS) {
          return { logs: newLogs.slice(newLogs.length - MAX_ADAPT_LOGS) }
        }
        return { logs: newLogs }
      })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_STREAM, ((...args: unknown[]) => {
      const data = args[0] as { chunk: string }
      set((state: AdaptStore) => ({ streamOutput: state.streamOutput + data.chunk }))
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_ERROR, ((...args: unknown[]) => {
      const data = args[0] as { message: string }
      set({ error: data.message, isRunning: false })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_STAGE_COMPLETE, ((...args: unknown[]) => {
      const report = args[0] as StageReport
      set({
        lastStageReport: report,
        isRunning: false,
        waterLevel: report.waterLevel || get().waterLevel
      })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    window.feicaiAPI.on(IPC.ADAPT_REVIEW_RESULT, ((...args: unknown[]) => {
      const data = args[0]
      set({ lastReviewResult: data })
    }) as (...args: unknown[]) => void)
  )

  return () => {
    for (const unsub of unsubscribers) unsub()
  }
}

export const useAdaptStore = create<AdaptStore>((set, get) => ({
  adaptState: 'adapt_idle',
  waterLevel: null,
  novelInfo: null,
  logs: [],
  streamOutput: '',
  isRunning: false,
  error: null,
  lastStageReport: null,
  lastReviewResult: null,
  adaptPlan: null,

  setupEventListeners: () => {
    _adaptListenerRefCount++
    if (_adaptListenerRefCount === 1) {
      _adaptCleanupFn = _registerAdaptListeners(set, get)
    }
    return () => {
      _adaptListenerRefCount--
      if (_adaptListenerRefCount <= 0) {
        _adaptListenerRefCount = 0
        if (_adaptCleanupFn) {
          _adaptCleanupFn()
          _adaptCleanupFn = null
        }
      }
    }
  },

  initAdapt: async (projectId, projectPath, llmConfig) => {
    set({ error: null, logs: [], streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_START, { projectId, projectPath, llmConfig })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  startBreakdown: async (batchCount = 1) => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_BREAKDOWN, { batchCount })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  startScript: async (batchCount = 1) => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_SCRIPT, { batchCount })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  startAuto: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_AUTO)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  pause: async () => {
    await window.feicaiAPI.invoke(IPC.ADAPT_PAUSE)
  },

  abort: async () => {
    await window.feicaiAPI.invoke(IPC.ADAPT_ABORT)
    set({ isRunning: false })
  },

  fetchStatus: async (projectPath) => {
    try {
      const status = await window.feicaiAPI.invoke(IPC.ADAPT_GET_STATUS, { projectPath }) as {
        novelInfo: NovelInfo | null
        waterLevel: WaterLevel
        state: AdaptState
      }
      set({
        novelInfo: status.novelInfo,
        waterLevel: status.waterLevel,
        adaptState: status.state
      })
    } catch { /* ignore */ }
  },

  clearStream: () => set({ streamOutput: '' }),
  clearLogs: () => set({ logs: [] }),

  // P1 新增
  initProject: async (novelTitle, novelGenre, projectPath, llmConfig) => {
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_INIT_PROJECT, {
        novelTitle, novelGenre, projectPath, llmConfig
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  reScript: async (episodeNum) => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_RE_SCRIPT, { episodeNum })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  fix: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_FIX)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  checkBreakdown: async (batchNumber) => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_CHECK_BREAKDOWN, { batchNumber })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  smartNext: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      const result = await window.feicaiAPI.invoke(IPC.ADAPT_SMART_NEXT) as {
        action: string
        description: string
      }
      return result
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
      return undefined
    }
  },

  // DA 新增
  revise: async (episodeNum: number, revisionNotes: string) => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_REVISE, { episodeNum, revisionNotes })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  breakdownAuto: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_BREAKDOWN_AUTO)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  scriptAuto: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_SCRIPT_AUTO)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  ensurePlan: async () => {
    set({ error: null, streamOutput: '', isRunning: true })
    try {
      await window.feicaiAPI.invoke(IPC.ADAPT_ENSURE_PLAN)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), isRunning: false })
    }
  },

  // 改编规划
  loadPlan: async (projectPath) => {
    try {
      const plan = await window.feicaiAPI.invoke(IPC.ADAPT_LOAD_PLAN, projectPath) as AdaptPlan | null
      set({ adaptPlan: plan })
    } catch { /* ignore */ }
  },

  savePlan: async (projectPath, plan) => {
    await window.feicaiAPI.invoke(IPC.ADAPT_SAVE_PLAN, { projectPath, plan })
    set({ adaptPlan: plan })
  },

  generatePlan: async (projectPath, volumePlan, llmConfig) => {
    const result = await window.feicaiAPI.invoke(IPC.ADAPT_GENERATE_PLAN, {
      projectPath, volumePlan, llmConfig
    }) as { llmPlan: string }
    return result.llmPlan
  }
}))
