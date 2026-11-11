import { join } from 'path'
import { readFileSync } from 'fs'
import type {
  AutomatedPipelineStage,
  PipelineSettings,
  PipelineState
} from '@shared/types'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { getDefaultLLMConfig } from '../db/llm-config-repository'
import { resolveProjectConfig } from './project-service'
import type { PipelineStateMachine } from '../engine/state-machine'
import type { WorkflowStepRunner } from '../workflow/workflow-step-runner'
import { createProvider } from '../llm/provider-factory'
import type {
  WorkflowStepRunResult,
  WorkflowStepRunner as WorkflowStepRunnerType
} from '../workflow/workflow-step-runner'
import type { ProjectContext } from '../engine/prompt-assembler'
import {
  acquireExecutionLease,
  releaseExecutionLease,
  getExecutionLease,
  stopExecution,
  type ExecutionLease
} from './batch-execution-lease'

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
  if (getExecutionLease()) return true
  if (!pipeline) return false
  return pipeline.isRunning()
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
  return {
    ...engine.getContext(),
    running: !!getExecutionLease() || engine.isRunning()
  }
}

export function pausePipeline(engine: PipelineStateMachine): {
  success: boolean
} {
  getExecutionLease()?.pause()
  engine.pause()
  return { success: true }
}

export async function abortPipeline(
  engine: PipelineStateMachine
): Promise<{ success: boolean }> {
  const stopping = stopExecution()
  await engine.abort()
  await stopping
  return { success: true }
}

export function resumePipeline(engine: PipelineStateMachine): {
  success: boolean
} {
  getExecutionLease()?.resume()
  engine.resume()
  return { success: true }
}

export async function retryPipeline(
  engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage
): Promise<{ success: boolean }> {
  const lease = acquireExecutionLease('pipeline-retry')
  try {
    await engine.retry(stage, {
      signal: lease.signal,
      runId: lease.runId,
      waitUntilResumed: () => lease.checkpoint()
    })
    return { success: true }
  } finally {
    releaseExecutionLease(lease)
  }
}

export async function skipPipelineReview(
  engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage
): Promise<{ success: boolean }> {
  const context = engine.getContext()
  await engine.skipReview(stage || context.currentStage)
  return { success: true }
}

export async function launchPipeline(
  engine: PipelineStateMachine,
  params: PipelineLaunchParams,
  options: {
    waitForCompletion: boolean
    lease?: ExecutionLease
    operationId?: string
  }
): Promise<{
  success?: boolean
  message?: string
  error?: string
  state?: PipelineState
  stage?: AutomatedPipelineStage
}> {
  const lease = acquireExecutionLease('pipeline', options.lease)
  const ownsLease = !options.lease
  try {
    const { pipelineSettings } = configurePipelineEngine(
      engine,
      params.projectPath
    )
    const projectConfig = resolveProjectConfig({
      projectId: params.projectId,
      projectPath: params.projectPath
    })
    const effectiveConfig = { ...projectConfig, pipelineSettings }

    const startArgs = {
      projectId: params.projectId,
      projectPath: params.projectPath,
      episodeNum: params.episodeNum,
      projectConfig: effectiveConfig,
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
      singleStage: params.singleStage,
      signal: lease.signal,
      runId: options.operationId || lease.runId,
      operationId: options.operationId,
      waitUntilResumed: () => lease.checkpoint()
    }

    const execution = engine.start(startArgs)
    const settled = execution.finally(() => {
      if (ownsLease) releaseExecutionLease(lease)
    })
    if (options.waitForCompletion) {
      await settled
      const ctx = engine.getContext()
      const success = ctx.state !== 'error' && ctx.state !== 'idle'
      return {
        success,
        state: ctx.state,
        stage: ctx.currentStage,
        error: ctx.error
      }
    }
    void settled.catch(console.error)
    return { success: true, message: '制作流程（导演→服化道→分镜）已启动' }
  } catch (error) {
    if (ownsLease) releaseExecutionLease(lease)
    throw error
  }
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
  signal?: AbortSignal
  batchNumber?: number
  operationId?: string
}

export async function runWorkflowAction(
  runner: WorkflowStepRunnerType,
  action: WorkflowActionName,
  params: WorkflowActionParams,
  existingLease?: ExecutionLease
): Promise<WorkflowStepRunResult> {
  const lease = acquireExecutionLease('workflow', existingLease)
  try {
    await lease.checkpoint()
    configureWorkflowRunner(runner)
    return await runner[action]({
      ...buildWorkflowStepParams(params),
      signal: lease.signal,
      batchNumber: params.batchNumber,
      operationId: params.operationId,
      waitUntilResumed: () => lease.checkpoint()
    })
  } finally {
    if (!existingLease) releaseExecutionLease(lease)
  }
}
