import { randomUUID } from 'crypto'
import { join } from 'path'
import { readFileSync } from 'fs'
import type {
  AutomatedPipelineStage,
  PipelineSettings,
  PipelineState,
  PipelineContext,
  LLMConfig
} from '@shared/types'
import { parsePipelineSettings } from '@shared/pipeline-settings'
import { samePipelineRun } from '@shared/pipeline-task'
import type {
  PipelineControlTarget,
  PipelineRunIdentity,
  PipelineTaskSnapshot
} from '@shared/pipeline-task'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { getDefaultLLMConfig } from '../db/llm-config-repository'
import { resolveProjectConfig, findRegisteredProject } from './project-service'
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
  type ExecutionLease
} from './batch-execution-lease'

type LaunchSnapshot = {
  params: PipelineLaunchParams
  settings: Readonly<PipelineSettings>
  provider: Readonly<LLMConfig>
  projectConfig: ReturnType<typeof resolveProjectConfig>
}

type TaskRecord = {
  snapshot: PipelineTaskSnapshot
  lease: ExecutionLease | null
  engine?: PipelineStateMachine
  launch?: LaunchSnapshot
}

// Capacity remains one. Retain only the latest task for display/retry, never a history.
let currentTask: TaskRecord | null = null
const runtimeBindings = new WeakMap<
  PipelineStateMachine,
  { emit: (event: string, data: unknown) => void; release: () => void }
>()
let taskSink: ((snapshot: PipelineTaskSnapshot) => void) | undefined

export function bindPipelineRuntime(
  engine: PipelineStateMachine,
  binding: { emit: (event: string, data: unknown) => void; release: () => void }
): void {
  runtimeBindings.set(engine, binding)
}

export function setPipelineTaskSink(
  sink: (snapshot: PipelineTaskSnapshot) => void
): void {
  taskSink = sink
}

export function resetPipelineTasks(): void {
  currentTask = null
  taskSink = undefined
}

function snapshotTask(task: TaskRecord): PipelineTaskSnapshot {
  return structuredClone({
    ...task.snapshot,
    ...(task.engine
      ? { context: taskContext(task, task.engine.getContext()) }
      : {})
  })
}

function publishTask(task: TaskRecord): void {
  try {
    taskSink?.(snapshotTask(task))
  } catch (error) {
    console.error('Pipeline task notification failed', error)
  }
}

export function listPipelineTasks(): PipelineTaskSnapshot[] {
  return currentTask ? [snapshotTask(currentTask)] : []
}

export function getPipelineTask(taskId: string): PipelineTaskSnapshot | null {
  return currentTask?.snapshot.identity.taskId === taskId
    ? snapshotTask(currentTask)
    : null
}

function requireTask(
  target?: PipelineControlTarget,
  allowSettled = false
): TaskRecord {
  const task = currentTask
  if (!task || (target && !samePipelineRun(target, task.snapshot.identity)))
    throw new Error('任务不存在或运行标识已失效')
  if (task.lease) {
    if (getExecutionLease() !== task.lease)
      throw new Error('任务执行租约已失效')
  } else if (!allowSettled || getExecutionLease()) {
    throw new Error('没有唯一可控制的活动任务')
  }
  return task
}

function taskContext(
  task: TaskRecord,
  context: PipelineContext
): PipelineContext {
  return {
    ...context,
    projectId: task.snapshot.identity.projectId,
    episodeNum: task.snapshot.identity.episodeNum ?? context.episodeNum,
    taskId: task.snapshot.identity.taskId,
    runId: task.snapshot.identity.runId,
    running: !!task.lease,
    logs: context.logs?.slice(-500) ?? [],
    reviews: context.reviews ?? []
  }
}

function observePipeline(
  task: TaskRecord,
  engine: PipelineStateMachine
): () => void {
  const binding = runtimeBindings.get(engine)
  if (!binding) return () => {}
  const handlers = [
    'stateChanged',
    'log',
    'stream',
    'stageComplete',
    'reviewResult',
    'error'
  ].map((event) => {
    const handler = (payload: Record<string, unknown>) => {
      if (currentTask !== task || !task.lease) return
      if (payload.runId && payload.runId !== task.snapshot.identity.runId)
        return
      const context =
        event === 'stateChanged'
          ? (payload.context as PipelineContext)
          : engine.getContext()
      if (context.runId && context.runId !== task.snapshot.identity.runId)
        return
      task.snapshot.identity = {
        ...task.snapshot.identity,
        stage: context.currentStage
      }
      const data = {
        ...payload,
        ...task.snapshot.identity,
        identity: { ...task.snapshot.identity },
        ...(event === 'stateChanged'
          ? { context: taskContext(task, context) }
          : {})
      }
      binding.emit(event, data)
    }
    engine.on(event, handler)
    return [event, handler] as const
  })
  let cleaned = false
  return () => {
    if (cleaned) return
    cleaned = true
    for (const [event, handler] of handlers) engine.off(event, handler)
    runtimeBindings.delete(engine)
    binding.release()
  }
}

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

export function loadPipelineSettings(projectPath: string): PipelineSettings {
  try {
    const raw = readFileSync(
      resolveProjectArtifactPath(projectPath, 'projectConfig'),
      'utf-8'
    )
    const config = JSON.parse(raw)
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('项目配置必须为对象')
    return parsePipelineSettings(config.pipelineSettings)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return parsePipelineSettings()
    throw new Error(
      `读取流水线配置失败：${error instanceof Error ? error.message : String(error)}`
    )
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
  engine.setProvider(Object.freeze(structuredClone(llmConfig)))

  const pipelineSettings = loadPipelineSettings(projectPath)
  engine.setPipelineSettings(pipelineSettings)

  return { pipelineSettings }
}

export function getPipelineContext(engine: PipelineStateMachine) {
  if (currentTask?.snapshot.context)
    return structuredClone(currentTask.snapshot.context)
  if (currentTask?.engine)
    return taskContext(currentTask, currentTask.engine.getContext())
  return { ...engine.getContext(), running: false }
}

export function pausePipeline(
  _engine: PipelineStateMachine,
  target?: PipelineControlTarget
): { success: boolean } {
  const task = requireTask(target)
  task.lease!.pause()
  task.engine?.pause()
  task.snapshot.status = 'paused'
  publishTask(task)
  return { success: true }
}

export async function abortPipeline(
  _engine: PipelineStateMachine,
  target?: PipelineControlTarget
): Promise<{ success: boolean }> {
  const task = requireTask(target)
  const lease = task.lease!
  lease.abort()
  await task.engine?.abort()
  await lease.wait()
  return { success: true }
}

export function resumePipeline(
  _engine: PipelineStateMachine,
  target?: PipelineControlTarget
): { success: boolean } {
  const task = requireTask(target)
  task.lease!.resume()
  task.engine?.resume()
  task.snapshot.status = 'running'
  publishTask(task)
  return { success: true }
}

export async function retryPipeline(
  engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage,
  target?: PipelineControlTarget
): Promise<{ success: boolean }> {
  const task = requireTask(target, true)
  if (task.lease || !task.launch) throw new Error('没有可重试的制作流程')
  const result = await launchPipeline(
    engine,
    {
      ...task.launch.params,
      startStage: stage || task.snapshot.context?.currentStage,
      singleStage: false
    },
    { waitForCompletion: true, retryTask: task }
  )
  return { success: result.success === true }
}

export async function skipPipelineReview(
  _engine: PipelineStateMachine,
  stage?: AutomatedPipelineStage,
  target?: PipelineControlTarget
): Promise<{ success: boolean }> {
  const task = requireTask(target)
  if (!task.engine) throw new Error('当前任务没有可跳过的自动审核')
  const context = task.engine.getContext()
  if (stage && stage !== context.currentStage) throw new Error('审核阶段不匹配')
  await task.engine.skipReview(stage || context.currentStage)
  return { success: true }
}

export async function launchPipeline(
  engine: PipelineStateMachine,
  params: PipelineLaunchParams,
  options: {
    waitForCompletion: boolean
    lease?: ExecutionLease
    operationId?: string
    retryTask?: TaskRecord
  }
): Promise<{
  identity?: PipelineRunIdentity
  success?: boolean
  message?: string
  error?: string
  state?: PipelineState
  stage?: AutomatedPipelineStage
}> {
  const lease = acquireExecutionLease('pipeline', options.lease)
  params = { ...params }
  const ownsLease = !options.lease
  let task: TaskRecord | undefined
  let cleanup = () => {}
  try {
    // All launch inputs are copied before execution. Provider credentials remain private.
    const previous = options.retryTask?.launch
    const provider = previous?.provider ?? getDefaultLLMConfig()
    if (!provider) throw new Error('请先在设置中配置 LLM 模型')
    const pipelineSettings = Object.freeze(
      structuredClone(
        previous?.settings ?? loadPipelineSettings(params.projectPath)
      )
    )
    const projectConfig = structuredClone(
      previous?.projectConfig ??
        resolveProjectConfig({
          projectId: params.projectId,
          projectPath: params.projectPath
        })
    )
    const launch: LaunchSnapshot = {
      params: Object.freeze({ ...params }),
      settings: pipelineSettings,
      provider: Object.freeze(structuredClone(provider)),
      projectConfig
    }
    engine.setProvider(launch.provider)
    engine.setPipelineSettings(pipelineSettings)
    const identity: PipelineRunIdentity = {
      projectId: params.projectId,
      taskId: options.retryTask?.snapshot.identity.taskId ?? randomUUID(),
      runId: randomUUID(),
      episodeNum: params.episodeNum,
      stage: params.startStage ?? 'director'
    }
    task = {
      snapshot: {
        identity,
        kind: 'pipeline',
        status: 'running',
        settings: pipelineSettings
      },
      lease,
      engine,
      launch
    }
    currentTask = task
    cleanup = observePipeline(task, engine)
    publishTask(task)
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
      runId: identity.runId,
      operationId: options.operationId,
      waitUntilResumed: () => lease.checkpoint()
    }

    const execution = engine.start(startArgs)
    const runningTask = task
    const settled = execution
      .catch((error) => {
        runningTask.snapshot.status = 'failed'
        throw error
      })
      .finally(() => {
        try {
          runningTask.lease = null
          const context = taskContext(runningTask, engine.getContext())
          runningTask.snapshot.context = context
          runningTask.snapshot.status = lease.signal.aborted
            ? 'stopped'
            : context.state === 'error' ||
                runningTask.snapshot.status === 'failed'
              ? 'failed'
              : 'completed'
          runningTask.engine = undefined
          // The final engine event precedes lease settlement; publish a final non-running projection.
          runtimeBindings.get(engine)?.emit('stateChanged', {
            newState: context.state,
            context,
            ...runningTask.snapshot.identity,
            identity: runningTask.snapshot.identity
          })
          publishTask(runningTask)
        } finally {
          cleanup()
          if (ownsLease) releaseExecutionLease(lease)
        }
      })
    if (options.waitForCompletion) {
      await settled
      const ctx = engine.getContext()
      const success = ctx.state !== 'error' && ctx.state !== 'idle'
      return {
        success,
        identity,
        state: ctx.state,
        stage: ctx.currentStage,
        error: ctx.error
      }
    }
    void settled.catch(console.error)
    return {
      success: true,
      identity,
      message: '制作流程（导演→服化道→分镜）已启动'
    }
  } catch (error) {
    cleanup()
    if (task) {
      task.lease = null
      task.engine = undefined
      task.snapshot.status = 'failed'
      publishTask(task)
    }
    if (ownsLease) releaseExecutionLease(lease)
    throw error
  }
}

export function configureWorkflowRunner(runner: WorkflowStepRunner): void {
  const llmConfig = getDefaultLLMConfig()
  if (!llmConfig) {
    throw new Error('请先在设置中配置 LLM 模型')
  }
  runner.setProvider(createProvider(Object.freeze(structuredClone(llmConfig))))
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
    projectConfig: { ...projectConfig, pipelineSettings },
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
  params = { ...params }
  let task: TaskRecord | undefined
  try {
    // Capture before the first await, including while an outer batch lease is paused.
    const provider = getDefaultLLMConfig()
    if (!provider) throw new Error('请先在设置中配置 LLM 模型')
    const step = structuredClone(buildWorkflowStepParams(params))
    const capturedProvider = Object.freeze(structuredClone(provider))
    const stages = {
      runStoryGeneration: 'story',
      runStoryReview: 'story_review',
      runScriptGeneration: 'script',
      runScriptReview: 'script_review',
      runCharacterDesign: 'character',
      runStoryboardReview: 'storyboard_review'
    } as const
    const projectId =
      params.projectId ??
      findRegisteredProject({ projectPath: params.projectPath })?.id
    if (!projectId) throw new Error('缺少项目标识')
    task = {
      snapshot: {
        identity: {
          projectId,
          taskId: randomUUID(),
          runId: randomUUID(),
          episodeNum: params.episodeNum,
          stage: stages[action]
        },
        kind: 'workflow',
        status: 'running',
        settings: Object.freeze({ ...step.projectConfig.pipelineSettings })
      },
      lease
    }
    currentTask = task
    publishTask(task)
    await lease.checkpoint()
    runner.setProvider(createProvider(capturedProvider))
    const result = await runner[action]({
      ...step,
      signal: lease.signal,
      batchNumber: params.batchNumber,
      operationId: params.operationId,
      waitUntilResumed: () => lease.checkpoint()
    })
    task.snapshot.status = result.success ? 'completed' : 'failed'
    return result
  } catch (error) {
    if (task) task.snapshot.status = 'failed'
    throw error
  } finally {
    if (task) {
      if (lease.signal.aborted) task.snapshot.status = 'stopped'
      task.lease = null
      publishTask(task)
    }
    if (!existingLease) releaseExecutionLease(lease)
  }
}
