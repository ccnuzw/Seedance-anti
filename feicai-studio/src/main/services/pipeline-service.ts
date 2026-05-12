import { join } from 'path'
import { readFileSync } from 'fs'
import type { AutomatedPipelineStage, PipelineSettings } from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { getDefaultLLMConfig } from '../db/llm-config-repository'
import { resolveProjectConfig } from './project-service'
import { PipelineStateMachine } from '../engine/state-machine'
import { WorkflowStepRunner } from '../workflow/workflow-step-runner'
import { createProvider } from '../llm/provider-factory'
import type {
  WorkflowStepRunResult,
  WorkflowStepRunner as WorkflowStepRunnerType
} from '../workflow/workflow-step-runner'
import type { ProjectContext } from '../engine/prompt-assembler'

export interface PipelineLaunchParams {
  projectId: string
  projectPath: string
  episodeNum: number
  projectName: string
  visualStyle: string
  targetMedium: string
  startStage?: AutomatedPipelineStage
  singleStage?: boolean
}

function buildProjectContext(params: {
  projectName: string
  visualStyle: string
  targetMedium: string
  episodeNum: number
  projectConfig?: ReturnType<typeof resolveProjectConfig> | null
  durationMin?: number
  durationMax?: number
  singlePromptMax?: number
  scriptWordCountMin?: number
  scriptWordCountMax?: number
}): ProjectContext {
  const context: ProjectContext = {
    projectName: params.projectName,
    visualStyle: params.visualStyle,
    targetMedium: params.targetMedium,
    episodeNumber: params.episodeNum
  }
  if (params.projectConfig?.totalEpisodes) {
    context.totalEpisodes = params.projectConfig.totalEpisodes
  }
  if (params.projectConfig?.chaptersPerEpisode) {
    context.chaptersPerEpisode = params.projectConfig.chaptersPerEpisode
  }
  if (params.durationMin !== undefined) context.durationMin = params.durationMin
  if (params.durationMax !== undefined) context.durationMax = params.durationMax
  if (params.singlePromptMax !== undefined) {
    context.singlePromptMax = params.singlePromptMax
  }
  if (params.scriptWordCountMin !== undefined) {
    context.scriptWordCountMin = params.scriptWordCountMin
  }
  if (params.scriptWordCountMax !== undefined) {
    context.scriptWordCountMax = params.scriptWordCountMax
  }
  return context
}

function loadPipelineSettings(projectPath: string): PipelineSettings {
  try {
    const raw = readFileSync(
      resolveProjectArtifactPath(projectPath, 'projectConfig'),
      'utf-8'
    )
    const config = JSON.parse(raw)
    return { ...DEFAULT_PIPELINE_SETTINGS, ...(config.pipelineSettings || {}) }
  } catch {
    return { ...DEFAULT_PIPELINE_SETTINGS }
  }
}

export function getSkillsDir(): string {
  const isDev =
    process.env.NODE_ENV === 'development' ||
    !require('electron').app.isPackaged
  if (isDev) {
    return join(process.cwd(), 'resources', 'builtin-skills')
  }
  return join(process.resourcesPath, 'builtin-skills')
}

export function isPipelineBusy(pipeline: PipelineStateMachine | null): boolean {
  if (!pipeline) return false
  const state = pipeline.getState()
  const terminalStates = ['idle', 'episode_complete', 'error', 'paused']
  return !terminalStates.includes(state)
}

export function configurePipelineEngine(
  engine: PipelineStateMachine,
  projectPath: string
): { pipelineSettings: PipelineSettings } {
  const llmConfig = getDefaultLLMConfig()
  if (!llmConfig) {
    throw new Error('请先在设置中配置 LLM 模型')
  }
  engine.setProvider(llmConfig)

  const pipelineSettings = loadPipelineSettings(projectPath)
  engine.setPipelineSettings(pipelineSettings)

  return { pipelineSettings }
}

export function getPipelineContext(engine: PipelineStateMachine) {
  return engine.getContext()
}

export function pausePipeline(engine: PipelineStateMachine): {
  success: boolean
} {
  engine.pause()
  return { success: true }
}

export function abortPipeline(engine: PipelineStateMachine): {
  success: boolean
} {
  engine.abort()
  return { success: true }
}

export function resumePipeline(engine: PipelineStateMachine): {
  success: boolean
} {
  engine.resume()
  return { success: true }
}

export function retryPipeline(
  engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage
): { success: boolean } {
  engine.retry(stage).catch(console.error)
  return { success: true }
}

export function skipPipelineReview(
  engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage
): { success: boolean } {
  const context = engine.getContext()
  engine.skipReview(stage || context.currentStage)
  return { success: true }
}

export async function launchPipeline(
  engine: PipelineStateMachine,
  params: PipelineLaunchParams,
  options: { waitForCompletion: boolean }
): Promise<{
  success?: boolean
  message?: string
  error?: string
  state?: string
  stage?: AutomatedPipelineStage
}> {
  const { pipelineSettings } = configurePipelineEngine(
    engine,
    params.projectPath
  )
  const projectConfig = resolveProjectConfig({
    projectId: params.projectId,
    projectPath: params.projectPath
  })

  const startArgs = {
    projectId: params.projectId,
    projectPath: params.projectPath,
    episodeNum: params.episodeNum,
    projectConfig,
    projectContext: buildProjectContext({
      projectName: params.projectName,
      visualStyle: params.visualStyle,
      targetMedium: params.targetMedium,
      episodeNum: params.episodeNum,
      projectConfig,
      durationMin: pipelineSettings.durationMin,
      durationMax: pipelineSettings.durationMax,
      singlePromptMax: pipelineSettings.singlePromptMax,
      scriptWordCountMin: pipelineSettings.scriptWordCountMin,
      scriptWordCountMax: pipelineSettings.scriptWordCountMax
    }),
    startStage: params.startStage,
    singleStage: params.singleStage
  }

  if (options.waitForCompletion) {
    await engine.start(startArgs)
    const ctx = engine.getContext()
    return { success: true, state: ctx.state, stage: ctx.currentStage }
  }

  engine.start(startArgs).catch((err) => {
    console.error('Pipeline error:', err)
  })
  return { success: true, message: '流水线已启动' }
}

export function configureWorkflowRunner(runner: WorkflowStepRunner): void {
  const llmConfig = getDefaultLLMConfig()
  if (!llmConfig) {
    throw new Error('请先在设置中配置 LLM 模型')
  }
  runner.setProvider(createProvider(llmConfig))
}

export function buildWorkflowStepParams(params: {
  projectId?: string
  projectPath: string
  episodeNum: number
  projectName: string
  visualStyle: string
  targetMedium: string
  reviewFeedback?: string
}) {
  const projectConfig = resolveProjectConfig({
    projectId: params.projectId,
    projectPath: params.projectPath
  })
  const pipelineSettings = loadPipelineSettings(params.projectPath)

  return {
    projectPath: params.projectPath,
    episodeNum: params.episodeNum,
    projectConfig,
    projectContext: buildProjectContext({
      projectName: params.projectName,
      visualStyle: params.visualStyle,
      targetMedium: params.targetMedium,
      episodeNum: params.episodeNum,
      projectConfig,
      durationMin: pipelineSettings.durationMin,
      durationMax: pipelineSettings.durationMax,
      singlePromptMax: pipelineSettings.singlePromptMax,
      scriptWordCountMin: pipelineSettings.scriptWordCountMin,
      scriptWordCountMax: pipelineSettings.scriptWordCountMax
    }),
    reviewFeedback: params.reviewFeedback
  }
}

export type WorkflowActionName =
  | 'runStoryGeneration'
  | 'runStoryReview'
  | 'runScriptGeneration'
  | 'runScriptReview'
  | 'runCharacterDesign'
  | 'runStoryboardReview'

export interface WorkflowActionParams {
  projectId?: string
  projectPath: string
  episodeNum: number
  projectName: string
  visualStyle: string
  targetMedium: string
  reviewFeedback?: string
}

export async function runWorkflowAction(
  runner: WorkflowStepRunnerType,
  action: WorkflowActionName,
  params: WorkflowActionParams
): Promise<WorkflowStepRunResult> {
  configureWorkflowRunner(runner)
  return await runner[action](buildWorkflowStepParams(params))
}
