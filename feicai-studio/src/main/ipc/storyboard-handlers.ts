import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PipelineState, PipelineStage, Project } from '@shared/types'
import { getProject, getDefaultLLMConfig, syncEpisodeStatus } from '../db/queries'
import { assertProjectPathAccess } from './path-access'
import { getPipelineManager } from './pipeline-handlers'
import { readProjectConfigSync } from '../project/project-config-store'

interface StoryboardRunParams {
  projectId: string
  projectPath: string
  episodeNum?: number
  waitForCompletion?: boolean
}

function buildProjectContext(project: Project, episodeNum: number) {
  const config = readProjectConfigSync(project.projectPath)
  const pipelineSettings = config?.pipelineSettings

  return {
    projectName: project.name,
    visualStyle: project.visualStyle,
    targetMedium: project.targetMedium,
    episodeNumber: episodeNum,
    durationMin: pipelineSettings?.durationMin || 90,
    durationMax: pipelineSettings?.durationMax || 120,
    singlePromptMax: pipelineSettings?.singlePromptMax || 10
  }
}

function ensureProject(projectId: string): Project {
  const project = getProject(projectId)
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`)
  }
  return project
}

function validateStoryboardResult(state: PipelineState, stage: PipelineStage): void {
  if (stage !== 'storyboard') {
    throw new Error(`分镜阶段执行结束于意外阶段: ${stage}`)
  }
  if (state !== 'episode_complete') {
    throw new Error(`分镜阶段未完成，当前状态: ${state}`)
  }
}

async function runStoryboard(params: StoryboardRunParams) {
  const manager = getPipelineManager()
  const safeProjectPath = assertProjectPathAccess(params.projectPath)
  const project = ensureProject(params.projectId)
  const episodeNum = params.episodeNum || 1
  const epStr = String(episodeNum).padStart(3, '0')

  if (!getDefaultLLMConfig('llm')) {
    throw new Error('未找到默认 LLM 配置，请先在设置中配置并设为默认模型')
  }

  if (!params.waitForCompletion) {
    await manager.start({
      projectId: project.id,
      projectPath: safeProjectPath,
      episodeNum,
      projectContext: buildProjectContext(project, episodeNum),
      startStage: 'storyboard',
      singleStage: true
    })

    return {
      success: true,
      message: `EP${String(episodeNum).padStart(2, '0')} 分镜阶段已启动`,
      activeRun: manager.getActiveRun()
    }
  }

  const result = await manager.runAndWait({
    projectId: project.id,
    projectPath: safeProjectPath,
    episodeNum,
    projectContext: buildProjectContext(project, episodeNum),
    startStage: 'storyboard',
    singleStage: true
  })
  const context = manager.getContext()
  syncEpisodeStatus(project.id, safeProjectPath)

  if (result.state === 'error') {
    const reviews = context.reviews || []
    const reviewFailures = reviews
      .filter((item) => item.stage === 'storyboard' && item.result === 'FAIL')
      .map((item) => item.feedback.trim())
      .filter(Boolean)

    return {
      success: false,
      state: result.state,
      stage: result.stage,
      error: context.error || '分镜阶段执行失败',
      reviews,
      reviewFailures,
      outputPath: `${safeProjectPath}/outputs/ep${epStr}/02-seedance-prompts.md`,
      message: reviewFailures.length > 0
        ? `分镜审核未通过：${reviewFailures.join('\n\n')}`
        : (context.error || '分镜阶段执行失败')
    }
  }

  validateStoryboardResult(result.state, result.stage)

  return {
    success: true,
    state: result.state,
    stage: result.stage,
    outputPath: context.seedancePromptsPath || `${safeProjectPath}/outputs/ep${epStr}/02-seedance-prompts.md`,
    reviews: context.reviews,
    message: `EP${String(episodeNum).padStart(2, '0')} 分镜 / Seedance 提示词已生成并通过两步审核`
  }
}

export function registerStoryboardHandlers(): void {
  ipcMain.handle(IPC.STORYBOARD_START, async (_event, params: StoryboardRunParams) => {
    try {
      return await runStoryboard({ ...params, waitForCompletion: false })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.STORYBOARD_RUN_AND_WAIT, async (_event, params: StoryboardRunParams) => {
    try {
      return await runStoryboard({ ...params, waitForCompletion: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })
}
