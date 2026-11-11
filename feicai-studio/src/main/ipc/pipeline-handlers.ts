import type { IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AutomatedPipelineStage } from '@shared/types'
import type {
  PipelineControlTarget,
  PipelineTaskControl
} from '@shared/pipeline-task'
import {
  assertEpisodeNumber,
  assertRegisteredProjectRoot
} from '../security/access-control'
import { registerSafeIpcHandler } from '../security/safe-ipc'
import { findRegisteredProject } from '../services/project-service'
import {
  abortPipeline,
  getPipelineContext,
  launchPipeline,
  pausePipeline,
  resumePipeline,
  retryPipeline,
  runWorkflowAction,
  skipPipelineReview,
  listPipelineTasks,
  getPipelineTask,
  type PipelineLaunchParams,
  type WorkflowActionParams,
  type WorkflowActionName
} from '../services/pipeline-service'
import {
  getPipelineRuntime,
  getWorkflowRunnerRuntime
} from '../services/pipeline-runtime-service'

export function getPipeline() {
  return getPipelineRuntime()
}

function validateStage(
  stage: unknown
): asserts stage is AutomatedPipelineStage | undefined {
  if (
    stage !== undefined &&
    !['director', 'art', 'storyboard'].includes(stage as string)
  ) {
    throw new Error('无效制作阶段')
  }
}

export function validatePipelineTarget(
  input: unknown
): PipelineControlTarget | undefined {
  if (input === undefined) return undefined
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('无效任务标识')
  const target = input as PipelineControlTarget
  for (const key of ['projectId', 'taskId', 'runId'] as const) {
    if (
      typeof target[key] !== 'string' ||
      !target[key].trim() ||
      target[key].length > 256
    )
      throw new Error('无效任务标识')
  }
  if (target.episodeNum !== undefined) assertEpisodeNumber(target.episodeNum)
  return {
    projectId: target.projectId,
    taskId: target.taskId,
    runId: target.runId,
    episodeNum: target.episodeNum
  }
}

function validateStageControl(input: unknown): {
  stage?: AutomatedPipelineStage
  target?: PipelineControlTarget
} {
  if (input && typeof input === 'object') {
    const { stage, target } = input as {
      stage?: AutomatedPipelineStage
      target?: unknown
    }
    validateStage(stage)
    if (target === undefined) throw new Error('缺少任务标识')
    return { stage, target: validatePipelineTarget(target) }
  }
  validateStage(input)
  return { stage: input }
}

export function validateWorkflowParams(input: unknown): WorkflowActionParams {
  if (!input || typeof input !== 'object') throw new Error('缺少任务参数')
  const params = input as WorkflowActionParams
  assertEpisodeNumber(params.episodeNum)
  if (params.batchNumber !== undefined) assertEpisodeNumber(params.batchNumber)
  for (const key of [
    'projectPath',
    'projectName',
    'visualStyle',
    'targetMedium'
  ] as const) {
    if (typeof params[key] !== 'string' || params[key].length > 10000)
      throw new Error(`无效任务参数: ${key}`)
  }
  if (
    params.reviewFeedback !== undefined &&
    (typeof params.reviewFeedback !== 'string' ||
      params.reviewFeedback.length > 200000)
  ) {
    throw new Error('无效审核反馈')
  }
  const projectPath = assertRegisteredProjectRoot(params.projectPath)
  if (
    params.projectId !== undefined &&
    (typeof params.projectId !== 'string' ||
      !params.projectId ||
      params.projectId.length > 256)
  )
    throw new Error('无效项目标识')
  const project = findRegisteredProject({
    projectId: params.projectId,
    projectPath
  })
  if (
    !project ||
    assertRegisteredProjectRoot(project.projectPath) !== projectPath
  )
    throw new Error('项目不存在或路径不匹配')
  // Copy only transport data: renderer can never supply a runtime lease or abort controller.
  return {
    projectId: project.id,
    projectPath,
    episodeNum: params.episodeNum,
    projectName: params.projectName,
    visualStyle: params.visualStyle,
    targetMedium: params.targetMedium,
    reviewFeedback: params.reviewFeedback,
    batchNumber: params.batchNumber
  }
}

function registerResultHandler(
  channel: string,
  action: (input: unknown) => unknown
): void {
  registerSafeIpcHandler(
    channel,
    async (_event: IpcMainInvokeEvent, input: unknown) => {
      try {
        return await action(input)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '制作任务失败'
        }
      }
    }
  )
}

export function registerPipelineHandlers(): void {
  for (const [channel, waitForCompletion] of [
    [IPC.PIPELINE_START, false],
    [IPC.PIPELINE_RUN_AND_WAIT, true]
  ] as const) {
    registerResultHandler(channel, (input) => {
      const common = validateWorkflowParams(input)
      const params = input as PipelineLaunchParams
      validateStage(params.startStage)
      if (
        params.singleStage !== undefined &&
        typeof params.singleStage !== 'boolean'
      )
        throw new Error('无效单阶段参数')
      if (typeof common.projectId !== 'string') throw new Error('缺少项目标识')
      return launchPipeline(
        getPipelineRuntime(),
        {
          ...common,
          projectId: common.projectId,
          startStage: params.startStage,
          singleStage: params.singleStage
        },
        { waitForCompletion }
      )
    })
  }
  registerResultHandler(IPC.PIPELINE_PAUSE, (input) =>
    pausePipeline(getPipelineRuntime(), validatePipelineTarget(input))
  )
  registerResultHandler(IPC.PIPELINE_ABORT, (input) =>
    abortPipeline(getPipelineRuntime(), validatePipelineTarget(input))
  )
  registerResultHandler(IPC.PIPELINE_RESUME, (input) =>
    resumePipeline(getPipelineRuntime(), validatePipelineTarget(input))
  )
  registerResultHandler(IPC.PIPELINE_RETRY, (input) => {
    const { stage, target } = validateStageControl(input)
    return retryPipeline(getPipelineRuntime(), stage, target)
  })
  registerResultHandler(IPC.PIPELINE_SKIP, (input) => {
    const { stage, target } = validateStageControl(input)
    return skipPipelineReview(getPipelineRuntime(), stage, target)
  })
  registerSafeIpcHandler(IPC.PIPELINE_GET_STATE, (_event, input: unknown) => {
    // An identity-bearing query cannot silently fall back to another task.
    const target = validatePipelineTarget(input)
    if (target) {
      const task = getPipelineTask(target.taskId)
      if (
        !task ||
        task.identity.projectId !== target.projectId ||
        task.identity.runId !== target.runId ||
        (target.episodeNum !== undefined &&
          task.identity.episodeNum !== target.episodeNum)
      )
        throw new Error('任务不存在或运行标识已失效')
      if (!task.context) throw new Error('当前任务没有自动流水线上下文')
      return task.context
    }
    return getPipelineContext(getPipelineRuntime())
  })
  registerSafeIpcHandler(IPC.PIPELINE_LIST_TASKS, () => listPipelineTasks())
  registerSafeIpcHandler(IPC.PIPELINE_GET_TASK, (_event, taskId: unknown) => {
    if (typeof taskId !== 'string' || !taskId || taskId.length > 256)
      throw new Error('无效任务标识')
    return getPipelineTask(taskId)
  })
  registerResultHandler(IPC.PIPELINE_CONTROL_TASK, (input) => {
    if (!input || typeof input !== 'object') throw new Error('无效任务控制')
    const request = input as PipelineTaskControl
    const target = validatePipelineTarget(request.target)
    if (!target) throw new Error('缺少任务标识')
    validateStage(request.stage)
    const engine = getPipelineRuntime()
    switch (request.action) {
      case 'pause':
        return pausePipeline(engine, target)
      case 'resume':
        return resumePipeline(engine, target)
      case 'abort':
        return abortPipeline(engine, target)
      case 'retry':
        return retryPipeline(engine, request.stage, target)
      case 'skip':
        return skipPipelineReview(engine, request.stage, target)
      default:
        throw new Error('无效任务控制')
    }
  })
  const workflows: Array<[string, WorkflowActionName]> = [
    [IPC.WORKFLOW_RUN_STORY_GENERATION, 'runStoryGeneration'],
    [IPC.WORKFLOW_RUN_STORY_REVIEW, 'runStoryReview'],
    [IPC.WORKFLOW_RUN_SCRIPT_GENERATION, 'runScriptGeneration'],
    [IPC.WORKFLOW_RUN_SCRIPT_REVIEW, 'runScriptReview'],
    [IPC.WORKFLOW_RUN_CHARACTER_DESIGN, 'runCharacterDesign'],
    [IPC.WORKFLOW_RUN_STORYBOARD_REVIEW, 'runStoryboardReview']
  ]
  for (const [channel, action] of workflows) {
    registerResultHandler(channel, (input) =>
      runWorkflowAction(
        getWorkflowRunnerRuntime(),
        action,
        validateWorkflowParams(input)
      )
    )
  }
}
