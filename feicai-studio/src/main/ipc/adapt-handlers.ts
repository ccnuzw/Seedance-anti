// ============================================================
// Adapt Handlers — 编剧管线 IPC Handlers
// ============================================================

import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { AdaptStateMachine } from '../engine/adapt-state-machine'
import { NovelManager } from '../engine/novel-manager'
import { PlotBreakdownParser } from '../engine/plot-breakdown-parser'
import { updateProjectPhase, syncEpisodesFromFilesystem } from '../db/queries'
import { getDatabase } from '../db/database'
import type { LLMConfig, AdaptPlan, VolumePlan } from '@shared/types'

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

    // 阶段自动升级：剧本创作完成后将项目升级到制作阶段
    adaptMachine.on('phaseUpgrade', (data: { projectId: string; projectPath: string }) => {
      try {
        updateProjectPhase(data.projectId, 'production')
        syncEpisodesFromFilesystem(data.projectId, data.projectPath, 0)

        // 同步 totalEpisodes：扫描 script/ 目录计算实际集数
        const scriptDir = join(data.projectPath, 'script')
        if (existsSync(scriptDir)) {
          const epFiles = readdirSync(scriptDir).filter((f: string) => /^ep\d+\.md$/.test(f))
          if (epFiles.length > 0) {
            const db = getDatabase()
            db.prepare('UPDATE projects SET total_episodes = ?, updated_at = ? WHERE id = ?')
              .run(epFiles.length, new Date().toISOString(), data.projectId)
          }
        }
      } catch (err) {
        console.error('[phaseUpgrade] 自动升级失败:', err)
      }
    })
  }
  return adaptMachine
}

export function registerAdaptHandlers(skillsDir: string): void {
  // 启动编剧管线
  ipcMain.handle(IPC.ADAPT_START, async (_e, params: {
    projectId: string
    projectPath: string
    llmConfig: LLMConfig
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    machine.setProvider(params.llmConfig)
    await machine.start({
      projectId: params.projectId,
      projectPath: params.projectPath
    })
    return machine.getContext()
  })

  // 执行拆解
  ipcMain.handle(IPC.ADAPT_BREAKDOWN, async (_e, params: {
    batchCount?: number
  }) => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.executeBreakdown(params?.batchCount || 1)
    return adaptMachine.getContext()
  })

  // 执行剧本创作
  ipcMain.handle(IPC.ADAPT_SCRIPT, async (_e, params: {
    batchCount?: number
  }) => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.executeScript(params?.batchCount || 1)
    return adaptMachine.getContext()
  })

  // 全自动模式
  ipcMain.handle(IPC.ADAPT_AUTO, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.executeAuto()
    return adaptMachine.getContext()
  })

  // 暂停
  ipcMain.handle(IPC.ADAPT_PAUSE, () => {
    adaptMachine?.pause()
    return adaptMachine?.getContext()
  })

  // 中止
  ipcMain.handle(IPC.ADAPT_ABORT, () => {
    adaptMachine?.abort()
    return adaptMachine?.getContext()
  })

  // 获取状态
  ipcMain.handle(IPC.ADAPT_GET_STATE, () => {
    return adaptMachine?.getContext() || null
  })

  // 获取进度状态（含水位）
  ipcMain.handle(IPC.ADAPT_GET_STATUS, async (_e, params: {
    projectPath: string
  }) => {
    const novelInfo = await novelManager.getNovelInfo(params.projectPath)
    const totalChapters = novelInfo?.totalChapters || 0
    const waterLevel = await breakdownParser.getWaterLevelFromFile(
      params.projectPath, totalChapters
    )
    return {
      novelInfo,
      waterLevel,
      state: adaptMachine?.getState() || 'adapt_idle'
    }
  })

  // 扫描小说
  ipcMain.handle(IPC.ADAPT_SCAN_NOVEL, async (_e, novelDir: string) => {
    return novelManager.scanNovelDir(novelDir)
  })

  // ==================== 小说管理 ====================

  // 导入小说
  ipcMain.handle(IPC.NOVEL_IMPORT, async (_e, params: {
    sourcePath: string
    projectPath: string
  }) => {
    return novelManager.importNovel(params.sourcePath, params.projectPath)
  })

  // 扫描小说目录
  ipcMain.handle(IPC.NOVEL_SCAN, async (_e, novelDir: string) => {
    return novelManager.scanNovelDir(novelDir)
  })

  // 读取章节
  ipcMain.handle(IPC.NOVEL_READ_CHAPTERS, async (_e, params: {
    novelDir: string
    startChapter: number
    count: number
  }) => {
    return novelManager.readChapters(params.novelDir, params.startChapter, params.count)
  })

  // 获取小说信息
  ipcMain.handle(IPC.NOVEL_GET_INFO, async (_e, projectPath: string) => {
    return novelManager.getNovelInfo(projectPath)
  })

  // ==================== 剧情拆解 ====================

  // 获取拆解数据
  ipcMain.handle(IPC.PLOT_GET_BREAKDOWN, async (_e, projectPath: string) => {
    return breakdownParser.parseFile(projectPath)
  })

  // 获取水位
  ipcMain.handle(IPC.PLOT_GET_WATER_LEVEL, async (_e, params: {
    projectPath: string
    totalChapters: number
  }) => {
    return breakdownParser.getWaterLevelFromFile(params.projectPath, params.totalChapters)
  })

  // ==================== P1 新增 ====================

  // [P1-4] 初始化项目（类型确定）
  ipcMain.handle(IPC.ADAPT_INIT_PROJECT, async (_e, params: {
    novelTitle: string
    novelGenre: string
    projectPath: string
    llmConfig: LLMConfig
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    machine.setProvider(params.llmConfig)
    await machine.initProject(params)
    return { success: true }
  })

  // [P1-6] 重新创作指定集
  ipcMain.handle(IPC.ADAPT_RE_SCRIPT, async (_e, params: {
    episodeNum: number
  }) => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.reCreateEpisode(params.episodeNum)
    return adaptMachine.getContext()
  })

  // [P1-7] 修正上批次
  ipcMain.handle(IPC.ADAPT_FIX, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.fixLastBatch()
    return adaptMachine.getContext()
  })

  // [P1-8] 手动拆解质检
  ipcMain.handle(IPC.ADAPT_CHECK_BREAKDOWN, async (_e, params: {
    batchNumber?: number
  }) => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    return adaptMachine.checkBreakdown(params?.batchNumber)
  })

  // [P1-9] 智能下一步
  ipcMain.handle(IPC.ADAPT_SMART_NEXT, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    return adaptMachine.smartNext()
  })

  // [DA-6] 内容修订
  ipcMain.handle(IPC.ADAPT_REVISE, async (_e, params: {
    episodeNum: number
    revisionNotes: string
  }) => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.reviseEpisode(params.episodeNum, params.revisionNotes)
    return adaptMachine.getContext()
  })

  // [DA-7] 独立拆解自动
  ipcMain.handle(IPC.ADAPT_BREAKDOWN_AUTO, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.executeBreakdownAuto()
    return adaptMachine.getContext()
  })

  // [DA-7] 独立创作自动
  ipcMain.handle(IPC.ADAPT_SCRIPT_AUTO, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.executeScriptAuto()
    return adaptMachine.getContext()
  })

  // [DA-4] 改编规划
  ipcMain.handle(IPC.ADAPT_ENSURE_PLAN, async () => {
    if (!adaptMachine) throw new Error('编剧管线未初始化')
    await adaptMachine.ensureAdaptPlan()
    return adaptMachine.getContext()
  })

  // ==================== 改编规划管理 ====================

  // 保存改编规划
  ipcMain.handle(IPC.ADAPT_SAVE_PLAN, async (_e, params: {
    projectPath: string
    plan: AdaptPlan
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    await machine.savePlan(params.projectPath, params.plan)
    return { success: true }
  })

  // 加载改编规划
  ipcMain.handle(IPC.ADAPT_LOAD_PLAN, async (_e, projectPath: string) => {
    const machine = getOrCreateMachine(skillsDir)
    return machine.loadPlan(projectPath)
  })

  // LLM 辅助生成单卷规划
  ipcMain.handle(IPC.ADAPT_GENERATE_PLAN, async (_e, params: {
    projectPath: string
    volumePlan: VolumePlan
    llmConfig: LLMConfig
  }) => {
    const machine = getOrCreateMachine(skillsDir)
    machine.setProvider(params.llmConfig)
    const result = await machine.generateVolumePlan(params.projectPath, params.volumePlan)
    return { llmPlan: result }
  })
}
