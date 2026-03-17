// ============================================================
// Pipeline IPC Handlers — 流水线控制的 IPC 处理器
// ============================================================

import { ipcMain, BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { IPC } from '@shared/ipc-channels'
import { PipelineStateMachine } from '../engine/state-machine'
import { getDefaultLLMConfig } from '../db/queries'
import type { PipelineStage, PipelineSettings } from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'

/** 从 project-config.json 读取 pipelineSettings */
function loadPipelineSettings(projectPath: string): PipelineSettings {
  try {
    const raw = readFileSync(join(projectPath, 'project-config.json'), 'utf-8')
    const config = JSON.parse(raw)
    return { ...DEFAULT_PIPELINE_SETTINGS, ...(config.pipelineSettings || {}) }
  } catch {
    return { ...DEFAULT_PIPELINE_SETTINGS }
  }
}

let pipeline: PipelineStateMachine | null = null

function getSkillsDir(): string {
  // 开发环境使用 resources 目录，生产环境使用打包后的资源
  const isDev = process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged
  if (isDev) {
    return join(process.cwd(), 'resources', 'builtin-skills')
  }
  return join(process.resourcesPath, 'builtin-skills')
}

export function getPipeline(): PipelineStateMachine {
  if (!pipeline) {
    pipeline = new PipelineStateMachine(getSkillsDir())
    setupPipelineEvents(pipeline)
  }
  return pipeline
}

/** 检查引擎是否正在执行（非终止状态） */
function isEngineBusy(): boolean {
  if (!pipeline) return false
  const state = pipeline.getState()
  const terminalStates = ['idle', 'episode_complete', 'error', 'paused']
  return !terminalStates.includes(state)
}

/**
 * 将引擎事件转发到渲染进程
 */
function setupPipelineEvents(engine: PipelineStateMachine): void {
  const send = (channel: string, data: unknown) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data)
      }
    }
  }

  engine.on('stateChanged', (data) => send(IPC.PIPELINE_STATE_CHANGED, data))
  engine.on('log', (data) => send(IPC.PIPELINE_LOG, data))
  engine.on('stream', (data) => send(IPC.PIPELINE_STREAM, data))
  engine.on('stageComplete', (data) => send(IPC.PIPELINE_STAGE_COMPLETE, data))
  engine.on('reviewResult', (data) => send(IPC.PIPELINE_REVIEW_RESULT, data))
  engine.on('error', (data) => send(IPC.PIPELINE_ERROR, data))
}

export function registerPipelineHandlers(): void {
  ipcMain.handle(IPC.PIPELINE_START, async (_event, params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
  }) => {
    try {
      const engine = getPipeline()

      // 互斥保护：如果引擎正在执行，拒绝新的启动请求
      if (isEngineBusy()) {
        return { error: '流水线正在执行中，请先停止当前任务' }
      }
      // 获取默认 LLM 配置
      const llmConfig = getDefaultLLMConfig()
      if (!llmConfig) {
        return { error: '请先在设置中配置 LLM 模型' }
      }
      engine.setProvider(llmConfig)

      // 加载项目级流水线参数
      const ps = loadPipelineSettings(params.projectPath)
      engine.setPipelineSettings(ps)

      // 启动流水线（异步执行，不等待完成）
      engine.start({
        projectId: params.projectId,
        projectPath: params.projectPath,
        episodeNum: params.episodeNum,
        projectContext: {
          projectName: params.projectName,
          visualStyle: params.visualStyle,
          targetMedium: params.targetMedium,
          episodeNumber: params.episodeNum,
          durationMin: ps.durationMin,
          durationMax: ps.durationMax,
          singlePromptMax: ps.singlePromptMax
        },
        startStage: params.startStage,
        singleStage: params.singleStage
      }).catch((err) => {
        console.error('Pipeline error:', err)
      })

      return { success: true, message: '流水线已启动' }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  // 批量模式：启动并等待完成
  ipcMain.handle(IPC.PIPELINE_RUN_AND_WAIT, async (_event, params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage?: PipelineStage
    singleStage?: boolean
  }) => {
    try {
      const engine = getPipeline()

      // 互斥保护
      if (isEngineBusy()) {
        return { error: '流水线正在执行中，请先停止当前任务' }
      }
      const llmConfig = getDefaultLLMConfig()
      if (!llmConfig) {
        return { error: '请先在设置中配置 LLM 模型' }
      }
      engine.setProvider(llmConfig)

      // 加载项目级流水线参数
      const ps = loadPipelineSettings(params.projectPath)
      engine.setPipelineSettings(ps)

      // 启动并等待完成（必须 await，否则 waitForCompletion 会因看到 idle 状态而立即返回）
      await engine.start({
        projectId: params.projectId,
        projectPath: params.projectPath,
        episodeNum: params.episodeNum,
        projectContext: {
          projectName: params.projectName,
          visualStyle: params.visualStyle,
          targetMedium: params.targetMedium,
          episodeNumber: params.episodeNum,
          durationMin: ps.durationMin,
          durationMax: ps.durationMax,
          singlePromptMax: ps.singlePromptMax
        },
        startStage: params.startStage,
        singleStage: params.singleStage
      })

      // start() 本身会一直执行到 episode_complete 或 error，直接返回最终状态
      const ctx = engine.getContext()
      return { success: true, state: ctx.state, stage: ctx.currentStage }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { error: msg }
    }
  })

  ipcMain.handle(IPC.PIPELINE_PAUSE, async () => {
    const engine = getPipeline()
    engine.pause()
    return { success: true }
  })

  ipcMain.handle(IPC.PIPELINE_ABORT, async () => {
    const engine = getPipeline()
    engine.abort()
    return { success: true }
  })

  ipcMain.handle(IPC.PIPELINE_RESUME, async () => {
    const engine = getPipeline()
    engine.resume()
    return { success: true }
  })

  ipcMain.handle(IPC.PIPELINE_RETRY, async (_event, stage?: PipelineStage) => {
    const engine = getPipeline()
    engine.retry(stage).catch(console.error)
    return { success: true }
  })

  ipcMain.handle(IPC.PIPELINE_SKIP, async (_event, stage?: PipelineStage) => {
    const engine = getPipeline()
    const ctx = engine.getContext()
    engine.skipReview(stage || ctx.currentStage)
    return { success: true }
  })

  ipcMain.handle(IPC.PIPELINE_GET_STATE, async () => {
    const engine = getPipeline()
    return engine.getContext()
  })
}
