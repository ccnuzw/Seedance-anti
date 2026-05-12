// ============================================================
// Pipeline IPC Handlers — 流水线控制的 IPC 处理器
// ============================================================

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AutomatedPipelineStage } from '@shared/types'
import { assertRegisteredProjectRoot } from '../security/access-control'
import {
  abortPipeline,
  getPipelineContext,
  isPipelineBusy,
  launchPipeline,
  pausePipeline,
  resumePipeline,
  retryPipeline,
  runWorkflowAction,
  skipPipelineReview
} from '../services/pipeline-service'
import {
  getPipelineRuntime,
  getWorkflowRunnerRuntime
} from '../services/pipeline-runtime-service'

export function getPipeline() {
  return getPipelineRuntime()
}

async function runWorkflowHandler(
  action:
    | 'runStoryGeneration'
    | 'runStoryReview'
    | 'runScriptGeneration'
    | 'runScriptReview'
    | 'runCharacterDesign'
    | 'runStoryboardReview',
  params: {
    projectId?: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
  }
): Promise<{
  success: boolean
  error?: string
  stage?: string
  outputPath?: string
  review?: unknown
}> {
  try {
    const trustedProjectPath = assertRegisteredProjectRoot(params.projectPath)
    const runner = getWorkflowRunnerRuntime()
    return await runWorkflowAction(runner, action, {
      ...params,
      projectPath: trustedProjectPath
    })
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function registerPipelineHandlers(): void {
  ipcMain.handle(
    IPC.PIPELINE_START,
    async (
      _event,
      params: {
        projectId: string
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
        startStage?: AutomatedPipelineStage
        singleStage?: boolean
      }
    ) => {
      try {
        const trustedProjectPath = assertRegisteredProjectRoot(
          params.projectPath
        )
        const engine = getPipelineRuntime()

        if (isPipelineBusy(engine)) {
          return { error: '流水线正在执行中，请先停止当前任务' }
        }
        return await launchPipeline(
          engine,
          { ...params, projectPath: trustedProjectPath },
          { waitForCompletion: false }
        )
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { error: msg }
      }
    }
  )

  // 批量模式：启动并等待完成
  ipcMain.handle(
    IPC.PIPELINE_RUN_AND_WAIT,
    async (
      _event,
      params: {
        projectId: string
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
        startStage?: AutomatedPipelineStage
        singleStage?: boolean
      }
    ) => {
      try {
        const trustedProjectPath = assertRegisteredProjectRoot(
          params.projectPath
        )
        const engine = getPipelineRuntime()

        if (isPipelineBusy(engine)) {
          return { error: '流水线正在执行中，请先停止当前任务' }
        }
        return await launchPipeline(
          engine,
          { ...params, projectPath: trustedProjectPath },
          { waitForCompletion: true }
        )
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { error: msg }
      }
    }
  )

  ipcMain.handle(IPC.PIPELINE_PAUSE, async () => {
    const engine = getPipelineRuntime()
    return pausePipeline(engine)
  })

  ipcMain.handle(IPC.PIPELINE_ABORT, async () => {
    const engine = getPipelineRuntime()
    return abortPipeline(engine)
  })

  ipcMain.handle(IPC.PIPELINE_RESUME, async () => {
    const engine = getPipelineRuntime()
    return resumePipeline(engine)
  })

  ipcMain.handle(
    IPC.PIPELINE_RETRY,
    async (_event, stage?: AutomatedPipelineStage) => {
      const engine = getPipelineRuntime()
      return retryPipeline(engine, stage)
    }
  )

  ipcMain.handle(
    IPC.PIPELINE_SKIP,
    async (_event, stage?: AutomatedPipelineStage) => {
      const engine = getPipelineRuntime()
      return skipPipelineReview(engine, stage)
    }
  )

  ipcMain.handle(IPC.PIPELINE_GET_STATE, async () => {
    const engine = getPipelineRuntime()
    return getPipelineContext(engine)
  })

  ipcMain.handle(
    IPC.WORKFLOW_RUN_STORY_GENERATION,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runStoryGeneration', params)
    }
  )

  ipcMain.handle(
    IPC.WORKFLOW_RUN_STORY_REVIEW,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runStoryReview', params)
    }
  )

  ipcMain.handle(
    IPC.WORKFLOW_RUN_SCRIPT_GENERATION,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runScriptGeneration', params)
    }
  )

  ipcMain.handle(
    IPC.WORKFLOW_RUN_SCRIPT_REVIEW,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runScriptReview', params)
    }
  )

  ipcMain.handle(
    IPC.WORKFLOW_RUN_CHARACTER_DESIGN,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runCharacterDesign', params)
    }
  )

  ipcMain.handle(
    IPC.WORKFLOW_RUN_STORYBOARD_REVIEW,
    async (
      _event,
      params: {
        projectPath: string
        episodeNum: number
        projectName: string
        visualStyle: string
        targetMedium: string
      }
    ) => {
      return await runWorkflowHandler('runStoryboardReview', params)
    }
  )
}
