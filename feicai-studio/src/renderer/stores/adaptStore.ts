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
  VolumePlan,
  ReviewResult,
  AdaptStage
} from '@shared/types'
import { platformAPI } from '@renderer/platform/api'

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

interface InvokeErrorResult {
  error: string
}

function isInvokeErrorResult(value: unknown): value is InvokeErrorResult {
  return typeof value === 'object' && value !== null && typeof (value as InvokeErrorResult).error === 'string'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function invokeAdapt<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await platformAPI.invoke(channel, payload)
  if (isInvokeErrorResult(result)) {
    throw new Error(result.error)
  }
  return result as T
}

interface AdaptStore {
  // 状态
  projectPath: string | null
  adaptState: AdaptState
  waterLevel: WaterLevel | null
  novelInfo: NovelInfo | null
  logs: LogEntry[]
  streamOutput: string
  isRunning: boolean
  error: string | null

  // 阶段报告
  lastStageReport: StageReport | null
  lastReviewResult: ReviewResult | null

  // 用户笔记 & 质检干预
  userNotes: string
  awaitingUser: boolean
  reviewFailedData: {
    stage: string
    result: unknown
    batchNum?: number
    retryCount: number
  } | null

  // 操作
  initAdapt: (projectId: string, projectPath: string, llmConfig: LLMConfig) => Promise<boolean>
  startBreakdown: (batchCount?: number) => Promise<boolean>
  startScript: (batchCount?: number) => Promise<boolean>
  startAuto: () => Promise<boolean>
  pause: () => Promise<boolean>
  abort: () => Promise<boolean>
  fetchStatus: (projectPath: string) => Promise<void>
  clearStream: () => void
  clearLogs: () => void
  setupEventListeners: () => () => void

  // P1 新增
  initProject: (novelTitle: string, novelGenre: string, projectPath: string, llmConfig: LLMConfig) => Promise<boolean>
  reScript: (episodeNum: number) => Promise<boolean>
  generateEpisode: (episodeNum: number) => Promise<boolean>
  rebuildBreakdown: (params: { chapterStart?: number; chapterEnd?: number; episodeStart?: number; episodeEnd?: number }) => Promise<boolean>
  fix: () => Promise<boolean>
  checkBreakdown: (batchNumber?: number) => Promise<boolean>
  checkScript: (episodeNum?: number) => Promise<boolean>
  smartNext: () => Promise<{ action: string; description: string } | undefined>

  // DA 新增
  revise: (episodeNum: number, revisionNotes: string) => Promise<boolean>
  breakdownAuto: () => Promise<boolean>
  scriptAuto: () => Promise<boolean>
  ensurePlan: () => Promise<boolean>

  // 改编规划
  adaptPlan: AdaptPlan | null
  loadPlan: (projectPath: string) => Promise<void>
  savePlan: (projectPath: string, plan: AdaptPlan) => Promise<boolean>
  generatePlan: (projectPath: string, volumePlan: VolumePlan, llmConfig: LLMConfig) => Promise<string>

  // 用户笔记 & 质检干预 actions
  loadNotes: (projectPath: string) => Promise<void>
  saveNotes: (projectPath: string, notes: string) => Promise<boolean>
  submitGuidance: (guidance: string) => Promise<boolean>
  clearReviewFailed: () => void

  // 核心！跨项目切换时的彻底清洗
  resetState: () => void
}

// ---- 引用计数事件监听（与 pipelineStore 同架构）----
let _adaptListenerRefCount = 0
let _adaptCleanupFn: (() => void) | null = null
const MAX_ADAPT_LOGS = 500
let _adaptStatusRequestSeq = 0
let _adaptPlanRequestSeq = 0
let _adaptNotesRequestSeq = 0

function _registerAdaptListeners(set: Function, get: Function): () => void {
  const unsubscribers: Array<() => void> = []

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_STATE_CHANGED, ((...args: unknown[]) => {
      const data = args[0] as { newState: AdaptState; context: AdaptContext }
      const isAwaiting = data.newState === 'adapt_awaiting_user'
      set({
        projectPath: data.context.projectPath,
        adaptState: data.newState,
        waterLevel: data.context.waterLevel,
        awaitingUser: isAwaiting,
        reviewFailedData: isAwaiting ? get().reviewFailedData : null,
        error: data.newState === 'adapt_error' ? get().error : null,
        isRunning: !['adapt_idle', 'adapt_error', 'adapt_paused', 'adapt_awaiting_user', 'breakdown_done', 'script_done'].includes(data.newState)
      })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_LOG, ((...args: unknown[]) => {
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
    platformAPI.on(IPC.ADAPT_STREAM, ((...args: unknown[]) => {
      const data = args[0] as { chunk: string }
      set((state: AdaptStore) => ({ streamOutput: state.streamOutput + data.chunk }))
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_ERROR, ((...args: unknown[]) => {
      const data = args[0] as { message: string; error?: string }
      const message = data.error ? `${data.message}: ${data.error}` : data.message
      set({ error: message, isRunning: false, lastStageReport: null })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_STAGE_COMPLETE, ((...args: unknown[]) => {
      const report = args[0] as StageReport
      set({
        lastStageReport: report,
        isRunning: false,
        waterLevel: report.waterLevel || get().waterLevel,
        awaitingUser: false,
        reviewFailedData: null,
        error: null
      })

      if (report.stage === 'script' || report.stage === 'revision') {
        setTimeout(() => {
          const { useProjectStore } = require('@renderer/stores/projectStore')
          useProjectStore.getState().syncEpisodeStatus()
        }, 0)
      }
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_REVIEW_RESULT, ((...args: unknown[]) => {
      const data = args[0] as { stage: AdaptStage; result: ReviewResult }
      set({ lastReviewResult: data.result, error: null })
    }) as (...args: unknown[]) => void)
  )

  unsubscribers.push(
    platformAPI.on(IPC.ADAPT_REVIEW_FAILED, ((...args: unknown[]) => {
      const data = args[0] as {
        stage: string
        result: unknown
        batchNum?: number
        retryCount: number
      }
      set({
        reviewFailedData: data,
        awaitingUser: true,
        isRunning: false,
        lastStageReport: null
      })
    }) as (...args: unknown[]) => void)
  )

  return () => {
    for (const unsub of unsubscribers) unsub()
  }
}

export const useAdaptStore = create<AdaptStore>((set, get) => ({
  projectPath: null,
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
  userNotes: '',
  awaitingUser: false,
  reviewFailedData: null,

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

  resetState: () => {
    set({
      projectPath: null,
      adaptState: 'adapt_idle',
      novelInfo: null,
      waterLevel: null,
      logs: [],
      streamOutput: '',
      isRunning: false,
      error: null,
      lastStageReport: null,
      lastReviewResult: null,
      adaptPlan: null,
      userNotes: '',
      awaitingUser: false,
      reviewFailedData: null
    })
  },

  initAdapt: async (projectId, projectPath, llmConfig) => {
    set({
      projectPath,
      error: null,
      logs: [],
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_START, { projectId, projectPath, llmConfig })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  startBreakdown: async (batchCount = 1) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_BREAKDOWN, { batchCount })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  startScript: async (batchCount = 1) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_SCRIPT, { batchCount })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  startAuto: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_AUTO)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  pause: async () => {
    set({ error: null })
    try {
      await invokeAdapt<{ success: true }>(IPC.ADAPT_PAUSE)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e) })
      return false
    }
  },

  abort: async () => {
    set({ error: null })
    try {
      await invokeAdapt<{ success: true }>(IPC.ADAPT_ABORT)
      set({ isRunning: false, awaitingUser: false, reviewFailedData: null, lastStageReport: null })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e) })
      return false
    }
  },

  fetchStatus: async (projectPath) => {
    const requestSeq = ++_adaptStatusRequestSeq
    const previousProjectPath = get().projectPath
    if (previousProjectPath && previousProjectPath !== projectPath) {
      set({
        projectPath,
        adaptState: 'adapt_idle',
        novelInfo: null,
        waterLevel: null,
        logs: [],
        streamOutput: '',
        isRunning: false,
        error: null,
        lastStageReport: null,
        lastReviewResult: null,
        adaptPlan: null,
        userNotes: '',
        awaitingUser: false,
        reviewFailedData: null
      })
    } else {
      set({ projectPath })
    }
    try {
      const status = await platformAPI.invoke(IPC.ADAPT_GET_STATUS, { projectPath }) as {
        novelInfo: NovelInfo | null
        waterLevel: WaterLevel
        state: AdaptState
      }
      if (requestSeq !== _adaptStatusRequestSeq) return
      set({
        novelInfo: status.novelInfo,
        waterLevel: status.waterLevel,
        adaptState: status.state,
        awaitingUser: status.state === 'adapt_awaiting_user',
        reviewFailedData: status.state === 'adapt_awaiting_user' ? get().reviewFailedData : null,
        isRunning: !['adapt_idle', 'adapt_error', 'adapt_paused', 'adapt_awaiting_user', 'breakdown_done', 'script_done'].includes(status.state)
      })
    } catch {
      if (requestSeq !== _adaptStatusRequestSeq) return
    }
  },

  clearStream: () => set({ streamOutput: '' }),
  clearLogs: () => set({ logs: [] }),

  // P1 新增
  initProject: async (novelTitle, novelGenre, projectPath, llmConfig) => {
    set({ projectPath, error: null })
    try {
      await invokeAdapt(IPC.ADAPT_INIT_PROJECT, {
        novelTitle, novelGenre, projectPath, llmConfig
      })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e) })
      return false
    }
  },

  reScript: async (episodeNum) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_RE_SCRIPT, { episodeNum })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  generateEpisode: async (episodeNum) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_GENERATE_EPISODE, { episodeNum })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  rebuildBreakdown: async (params) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_REBUILD_BREAKDOWN, params)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  fix: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_FIX)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  checkBreakdown: async (batchNumber) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_CHECK_BREAKDOWN, { batchNumber })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  checkScript: async (episodeNum) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_CHECK_SCRIPT, { episodeNum })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  smartNext: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      const result = await invokeAdapt<{
        action: string
        description: string
      }>(IPC.ADAPT_SMART_NEXT)
      return result
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return undefined
    }
  },

  // DA 新增
  revise: async (episodeNum: number, revisionNotes: string) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_REVISE, { episodeNum, revisionNotes })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  breakdownAuto: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_BREAKDOWN_AUTO)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  scriptAuto: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastReviewResult: null,
      lastStageReport: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_SCRIPT_AUTO)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  ensurePlan: async () => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastStageReport: null,
      lastReviewResult: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_ENSURE_PLAN)
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  // 改编规划
  loadPlan: async (projectPath) => {
    const requestSeq = ++_adaptPlanRequestSeq
    try {
      const plan = await platformAPI.invoke(IPC.ADAPT_LOAD_PLAN, projectPath) as AdaptPlan | null
      if (requestSeq !== _adaptPlanRequestSeq) return
      set({ adaptPlan: plan })
    } catch {
      if (requestSeq !== _adaptPlanRequestSeq) return
    }
  },

  savePlan: async (projectPath, plan) => {
    set({ error: null })
    try {
      await invokeAdapt(IPC.ADAPT_SAVE_PLAN, { projectPath, plan })
      set({ adaptPlan: plan })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e) })
      return false
    }
  },

  generatePlan: async (projectPath, volumePlan, llmConfig) => {
    const result = await invokeAdapt<{ llmPlan: string }>(IPC.ADAPT_GENERATE_PLAN, {
      projectPath, volumePlan, llmConfig
    })
    return result.llmPlan
  },

  // 用户笔记 & 质检干预
  loadNotes: async (projectPath) => {
    const requestSeq = ++_adaptNotesRequestSeq
    try {
      const notes = await platformAPI.invoke(IPC.ADAPT_LOAD_NOTES, projectPath) as string | undefined
      if (requestSeq !== _adaptNotesRequestSeq) return
      set({ userNotes: notes || '' })
    } catch {
      if (requestSeq !== _adaptNotesRequestSeq) return
    }
  },

  saveNotes: async (projectPath, notes) => {
    set({ error: null })
    try {
      await invokeAdapt(IPC.ADAPT_SAVE_NOTES, { projectPath, notes })
      set({ userNotes: notes })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e) })
      return false
    }
  },

  submitGuidance: async (guidance) => {
    set({
      error: null,
      streamOutput: '',
      isRunning: true,
      awaitingUser: false,
      reviewFailedData: null,
      lastStageReport: null,
      lastReviewResult: null
    })
    try {
      await invokeAdapt(IPC.ADAPT_SUBMIT_GUIDANCE, { guidance })
      return true
    } catch (e) {
      set({ error: getErrorMessage(e), isRunning: false })
      return false
    }
  },

  clearReviewFailed: () => set({ reviewFailedData: null, awaitingUser: false })
}))
