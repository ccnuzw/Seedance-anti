import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { PipelineState, PipelineStage, Project } from '@shared/types'
import { getProject, getDefaultLLMConfig, syncEpisodeStatus } from '../db/queries'
import { assertProjectPathAccess } from './path-access'
import { getPipelineManager } from './pipeline-handlers'
import { readProjectConfigSync } from '../project/project-config-store'

interface ArtRunParams {
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

function validateArtResult(state: PipelineState, stage: PipelineStage): void {
  if (stage !== 'art') {
    throw new Error(`服化道阶段执行结束于意外阶段: ${stage}`)
  }
  if (state !== 'art_done') {
    throw new Error(`服化道阶段未完成，当前状态: ${state}`)
  }
}

async function runArt(params: ArtRunParams) {
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
      startStage: 'art',
      singleStage: true
    })

    return {
      success: true,
      message: `EP${String(episodeNum).padStart(2, '0')} 服化道阶段已启动`,
      activeRun: manager.getActiveRun()
    }
  }

  const result = await manager.runAndWait({
    projectId: project.id,
    projectPath: safeProjectPath,
    episodeNum,
    projectContext: buildProjectContext(project, episodeNum),
    startStage: 'art',
    singleStage: true
  })
  const context = manager.getContext()
  syncEpisodeStatus(project.id, safeProjectPath)

  if (result.state === 'error') {
    return {
      success: false,
      state: result.state,
      stage: result.stage,
      error: context.error || '服化道阶段执行失败',
      reviews: context.reviews,
      outputPath: `${safeProjectPath}/outputs/ep${String(episodeNum).padStart(3, '0')}/01.5-art-design-output.md`,
      message: context.error || '服化道阶段执行失败'
    }
  }

  validateArtResult(result.state, result.stage)

  return {
    success: true,
    state: result.state,
    stage: result.stage,
    outputPath: `${safeProjectPath}/outputs/ep${String(episodeNum).padStart(3, '0')}/01.5-art-design-output.md`,
    characterPromptsPath: `${safeProjectPath}/assets/character-prompts.md`,
    scenePromptsPath: `${safeProjectPath}/assets/scene-prompts.md`,
    reviews: context.reviews,
    message: `EP${String(episodeNum).padStart(2, '0')} 服化道已生成并通过两步审核`
  }
}

export function registerArtHandlers(): void {
  ipcMain.handle(IPC.ART_START, async (_event, params: ArtRunParams) => {
    try {
      return await runArt({ ...params, waitForCompletion: false })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.ART_RUN_AND_WAIT, async (_event, params: ArtRunParams) => {
    try {
      return await runArt({ ...params, waitForCompletion: true })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, error: msg }
    }
  })
}
