// ============================================================
// Adapt Handlers — 编剧管线 IPC Handlers
// ============================================================

import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { AdaptStateMachine } from '../engine/adapt-state-machine'
import { NovelManager } from '../engine/novel-manager'
import { PlotBreakdownParser } from '../engine/plot-breakdown-parser'
import { updateProjectPhase, syncEpisodesFromFilesystem } from '../db/queries'
import type { LLMConfig, AdaptPlan, VolumePlan, AdaptSettings, ReviewPolicyConfig, FlowConfig } from '@shared/types'
import { DEFAULT_ADAPT_SETTINGS, DEFAULT_REVIEW_POLICY, DEFAULT_FLOW_CONFIG } from '@shared/types'
import { assertPathAccess, assertProjectPathAccess } from './path-access'
import { readProjectConfigSync } from '../project/project-config-store'

/** 从 project-config.json 读取 Adapt 设置 */
function loadAdaptSettings(projectPath: string): AdaptSettings {
  const config = readProjectConfigSync(projectPath)
  return { ...DEFAULT_ADAPT_SETTINGS, ...(config?.adaptSettings || {}) }
}

/** 从 project-config.json 读取 ReviewPolicy + FlowConfig */
function loadAdaptReviewAndFlow(projectPath: string): {
  reviewPolicy: ReviewPolicyConfig
  flowConfig: FlowConfig
} {
  const config = readProjectConfigSync(projectPath)
  return {
    reviewPolicy: { ...DEFAULT_REVIEW_POLICY, ...(config?.reviewPolicy || {}) },
    flowConfig: { ...DEFAULT_FLOW_CONFIG, ...(config?.flowConfig || {}) }
  }
}

let adaptMachine: AdaptStateMachine | null = null
const novelManager = new NovelManager()
const breakdownParser = new PlotBreakdownParser()

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

function getOrCreateMachine(skillsDir: string): AdaptStateMachine {
  if (!adaptMachine) {
    adaptMachine = new AdaptStateMachine(skillsDir)

    // 转发事件到渲染进程
    adaptMachine.on('stateChanged', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_STATE_CHANGED, data)
    })
    adaptMachine.on('log', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_LOG, data)
    })
    adaptMachine.on('stream', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_STREAM, data)
    })
    adaptMachine.on('stageComplete', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_STAGE_COMPLETE, data)
    })
    adaptMachine.on('reviewResult', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_REVIEW_RESULT, data)
    })
    adaptMachine.on('error', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_ERROR, data)
    })
    adaptMachine.on('reviewFailed', (data) => {
      getMainWindow()?.webContents.send(IPC.ADAPT_REVIEW_FAILED, data)
    })

    // 阶段自动升级：剧本创作完成后将项目升级到制作阶段
    adaptMachine.on('phaseUpgrade', (data: { projectId: string; projectPath: string }) => {
      try {
        updateProjectPhase(data.projectId, 'production')
        syncEpisodesFromFilesystem(data.projectId, data.projectPath, 0)
      } catch (err) {
        console.error('[phaseUpgrade] 自动升级失败:', err)
      }
    })
  }
  return adaptMachine
}

function reloadEngineSettings(machine: AdaptStateMachine) {
  const projectPath = machine.getContext().projectPath
  if (projectPath) {
    const as = loadAdaptSettings(projectPath)
    const { reviewPolicy, flowConfig } = loadAdaptReviewAndFlow(projectPath)
    machine.setSettings(as)
    machine.setReviewPolicy(reviewPolicy)
    machine.setFlowConfig(flowConfig)
  }
}

export function registerAdaptHandlers(skillsDir: string): void {
  // 启动编剧管线
  ipcMain.handle(IPC.ADAPT_START, async (_e, params: {
    projectId: string
    projectPath: string
    llmConfig: LLMConfig
  }) => {
    try {
      const machine = getOrCreateMachine(skillsDir)
      const safeProjectPath = assertProjectPathAccess(params.projectPath)
      machine.setProvider(params.llmConfig)
      // 加载项目级 Adapt 设置
      const as = loadAdaptSettings(safeProjectPath)
      const { reviewPolicy, flowConfig } = loadAdaptReviewAndFlow(safeProjectPath)
      machine.setSettings(as)
      machine.setReviewPolicy(reviewPolicy)
      machine.setFlowConfig(flowConfig)
      await machine.start({
        projectId: params.projectId,
        projectPath: safeProjectPath
      })
      return machine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 执行拆解
  ipcMain.handle(IPC.ADAPT_BREAKDOWN, async (_e, params: {
    batchCount?: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.executeBreakdown(params?.batchCount || 1)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 执行剧本创作
  ipcMain.handle(IPC.ADAPT_SCRIPT, async (_e, params: {
    batchCount?: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.executeScript(params?.batchCount || 1)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 全自动模式
  ipcMain.handle(IPC.ADAPT_AUTO, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.executeAuto()
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 暂停
  ipcMain.handle(IPC.ADAPT_PAUSE, () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      adaptMachine.pause()
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 中止
  ipcMain.handle(IPC.ADAPT_ABORT, () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      adaptMachine.abort()
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 获取状态
  ipcMain.handle(IPC.ADAPT_GET_STATE, () => {
    if (!adaptMachine) return null
    // 防止串台
    return adaptMachine.getContext()
  })

  // 获取进度状态（含水位）
  ipcMain.handle(IPC.ADAPT_GET_STATUS, async (_e, params: {
    projectPath: string
  }) => {
    const safeProjectPath = assertProjectPathAccess(params.projectPath)
    const novelInfo = await novelManager.getNovelInfo(safeProjectPath)
    const totalChapters = novelInfo?.totalChapters || 0
    const waterLevel = await breakdownParser.getWaterLevelFromFile(
      safeProjectPath, totalChapters
    )

    let state: string = 'adapt_idle'
    if (adaptMachine) {
      const ctx = adaptMachine.getContext()
      if (ctx.projectPath === safeProjectPath) {
        state = adaptMachine.getState()
      }
    }

    return {
      novelInfo,
      waterLevel,
      state
    }
  })

  // 扫描小说
  ipcMain.handle(IPC.ADAPT_SCAN_NOVEL, async (_e, novelDir: string) => {
    return novelManager.scanNovelDir(assertPathAccess(novelDir))
  })

  // ==================== 小说管理 ====================

  // 导入小说
  ipcMain.handle(IPC.NOVEL_IMPORT, async (_e, params: {
    sourcePath: string
    projectPath: string
  }) => {
    return novelManager.importNovel(
      assertPathAccess(params.sourcePath),
      assertProjectPathAccess(params.projectPath)
    )
  })

  // 扫描小说目录
  ipcMain.handle(IPC.NOVEL_SCAN, async (_e, novelDir: string) => {
    return novelManager.scanNovelDir(assertPathAccess(novelDir))
  })

  // 读取章节
  ipcMain.handle(IPC.NOVEL_READ_CHAPTERS, async (_e, params: {
    novelDir: string
    startChapter: number
    count: number
  }) => {
    return novelManager.readChapters(
      assertPathAccess(params.novelDir),
      params.startChapter,
      params.count
    )
  })

  // 获取小说信息
  ipcMain.handle(IPC.NOVEL_GET_INFO, async (_e, projectPath: string) => {
    return novelManager.getNovelInfo(assertProjectPathAccess(projectPath))
  })

  // ==================== 剧情拆解 ====================

  // 获取拆解数据
  ipcMain.handle(IPC.PLOT_GET_BREAKDOWN, async (_e, projectPath: string) => {
    return breakdownParser.parseFile(assertProjectPathAccess(projectPath))
  })

  // 获取水位
  ipcMain.handle(IPC.PLOT_GET_WATER_LEVEL, async (_e, params: {
    projectPath: string
    totalChapters: number
  }) => {
    return breakdownParser.getWaterLevelFromFile(
      assertProjectPathAccess(params.projectPath),
      params.totalChapters
    )
  })

  // ==================== P1 新增 ====================

  // [P1-4] 初始化项目（类型确定）
  ipcMain.handle(IPC.ADAPT_INIT_PROJECT, async (_e, params: {
    novelTitle: string
    novelGenre: string
    projectPath: string
    llmConfig: LLMConfig
  }) => {
    try {
      const machine = getOrCreateMachine(skillsDir)
      const safeProjectPath = assertProjectPathAccess(params.projectPath)
      machine.setProvider(params.llmConfig)
      // 初始化阶段同样加载项目级 Adapt 设置（如果存在）
      const as = loadAdaptSettings(safeProjectPath)
      const { reviewPolicy, flowConfig } = loadAdaptReviewAndFlow(safeProjectPath)
      machine.setSettings(as)
      machine.setReviewPolicy(reviewPolicy)
      machine.setFlowConfig(flowConfig)
      await machine.initProject({ ...params, projectPath: safeProjectPath })
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [P1-6] 重新创作指定集
  ipcMain.handle(IPC.ADAPT_RE_SCRIPT, async (_e, params: {
    episodeNum: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.reCreateEpisode(params.episodeNum)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.ADAPT_GENERATE_EPISODE, async (_e, params: {
    episodeNum: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.generateEpisode(params.episodeNum)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.ADAPT_REBUILD_BREAKDOWN, async (_e, params: {
    chapterStart?: number
    chapterEnd?: number
    episodeStart?: number
    episodeEnd?: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.rebuildBreakdown(params || {})
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [P1-7] 修正上批次
  ipcMain.handle(IPC.ADAPT_FIX, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      reloadEngineSettings(adaptMachine)
      await adaptMachine.fixLastBatch()
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [P1-8] 手动拆解质检
  ipcMain.handle(IPC.ADAPT_CHECK_BREAKDOWN, async (_e, params: {
    batchNumber?: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      return adaptMachine.checkBreakdown(params?.batchNumber)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 手动剧本质检
  ipcMain.handle(IPC.ADAPT_CHECK_SCRIPT, async (_e, params: {
    episodeNum?: number
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      return adaptMachine.checkScript(params?.episodeNum)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [P1-9] 智能下一步
  ipcMain.handle(IPC.ADAPT_SMART_NEXT, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      return adaptMachine.smartNext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [DA-6] 内容修订
  ipcMain.handle(IPC.ADAPT_REVISE, async (_e, params: {
    episodeNum: number
    revisionNotes: string
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      await adaptMachine.reviseEpisode(params.episodeNum, params.revisionNotes)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [DA-7] 独立拆解自动
  ipcMain.handle(IPC.ADAPT_BREAKDOWN_AUTO, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      await adaptMachine.executeBreakdownAuto()
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [DA-7] 独立创作自动
  ipcMain.handle(IPC.ADAPT_SCRIPT_AUTO, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      await adaptMachine.executeScriptAuto()
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // [DA-4] 改编规划
  ipcMain.handle(IPC.ADAPT_ENSURE_PLAN, async () => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      await adaptMachine.ensureAdaptPlan()
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // ==================== 改编规划管理 ====================

  // 保存改编规划
  ipcMain.handle(IPC.ADAPT_SAVE_PLAN, async (_e, params: {
    projectPath: string
    plan: AdaptPlan
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    await machine.savePlan(assertProjectPathAccess(params.projectPath), params.plan)
    return { success: true }
  })

  // 加载改编规划
  ipcMain.handle(IPC.ADAPT_LOAD_PLAN, async (_e, projectPath: string) => {
    const machine = getOrCreateMachine(skillsDir)
    return machine.loadPlan(assertProjectPathAccess(projectPath))
  })

  // LLM 辅助生成单卷规划
  ipcMain.handle(IPC.ADAPT_GENERATE_PLAN, async (_e, params: {
    projectPath: string
    volumePlan: VolumePlan
    llmConfig: LLMConfig
  }) => {
    try {
      const machine = getOrCreateMachine(skillsDir)
      const safeProjectPath = assertProjectPathAccess(params.projectPath)
      machine.setProvider(params.llmConfig)
      const result = await machine.generateVolumePlan(safeProjectPath, params.volumePlan)
      return { llmPlan: result }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // ==================== 用户笔记 & 质检干预 ====================

  // 保存用户指导笔记
  ipcMain.handle(IPC.ADAPT_SAVE_NOTES, async (_e, params: {
    projectPath: string
    notes: string
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    await machine.saveUserNotes(assertProjectPathAccess(params.projectPath), params.notes)
    return { success: true }
  })

  // 加载用户指导笔记
  ipcMain.handle(IPC.ADAPT_LOAD_NOTES, async (_e, projectPath: string) => {
    const machine = getOrCreateMachine(skillsDir)
    return machine.loadUserNotes(assertProjectPathAccess(projectPath))
  })

  // 用户提交质检修正指导
  ipcMain.handle(IPC.ADAPT_SUBMIT_GUIDANCE, async (_e, params: {
    guidance: string
  }) => {
    try {
      if (!adaptMachine) throw new Error('编剧管线未初始化')
      await adaptMachine.submitUserGuidance(params.guidance)
      return adaptMachine.getContext()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })
}
