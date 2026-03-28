import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PipelineState, PipelineStage, Project } from '@shared/types'
import { getProject, getDefaultLLMConfig, syncEpisodeStatus } from '../db/queries'
import { assertProjectPathAccess } from './path-access'
import { getPipelineManager } from './pipeline-handlers'
import { readProjectConfigSync } from '../project/project-config-store'

interface DirectorRunParams {
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

function validateDirectorResult(state: PipelineState, stage: PipelineStage): void {
  if (stage !== 'director') {
    throw new Error(`导演阶段执行结束于意外阶段: ${stage}`)
  }
  if (state !== 'director_done') {
    throw new Error(`导演阶段未完成，当前状态: ${state}`)
  }
}

async function runDirector(params: DirectorRunParams) {
  const manager = getPipelineManager()
  const safeProjectPath = assertProjectPathAccess(params.projectPath)
  const project = ensureProject(params.projectId)
  const episodeNum = params.episodeNum || 1

  if (!getDefaultLLMConfig('llm')) {
    throw new Error('未找到默认 LLM 配置，请先在设置中配置并设为默认模型')
  }

  if (!params.waitForCompletion) {
    await manager.start({
      projectId: project.id,
      projectPath: safeProjectPath,
      episodeNum,
      projectContext: buildProjectContext(project, episodeNum),
      startStage: 'director',
      singleStage: true
    })

    return {
      success: true,
      message: `EP${String(episodeNum).padStart(2, '0')} 导演阶段已启动`,
      activeRun: manager.getActiveRun()
    }
  }

  const result = await manager.runAndWait({
    projectId: project.id,
    projectPath: safeProjectPath,
    episodeNum,
    projectContext: buildProjectContext(project, episodeNum),
    startStage: 'director',
    singleStage: true
  })
  const context = manager.getContext()
  syncEpisodeStatus(project.id, safeProjectPath)

  if (result.state === 'error') {
    return {
      success: false,
      state: result.state,
      stage: result.stage,
      error: context.error || '导演阶段执行失败',
      reviews: context.reviews,
      outputPath: context.directorAnalysisPath
    }
  }

  validateDirectorResult(result.state, result.stage)

  return {
    success: true,
    state: result.state,
    stage: result.stage,
    outputPath: context.directorAnalysisPath,
    reviews: context.reviews,
    message: `EP${String(episodeNum).padStart(2, '0')} 导演分析已生成并通过两步审核`
  }
}

export function registerDirectorHandlers(): void {
  ipcMain.handle(IPC.DIRECTOR_START, async (_event, params: DirectorRunParams) => {
    try {
      return await runDirector({ ...params, waitForCompletion: false })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.DIRECTOR_RUN_AND_WAIT, async (_event, params: DirectorRunParams) => {
    try {
      return await runDirector({ ...params, waitForCompletion: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })
}
