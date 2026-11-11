import type { IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AutomatedPipelineStage } from '@shared/types'
import {
  assertEpisodeNumber,
  assertRegisteredProjectRoot
} from '../security/access-control'
import { registerSafeIpcHandler } from '../security/safe-ipc'
import {
  abortPipeline,
  getPipelineContext,
  launchPipeline,
  pausePipeline,
  resumePipeline,
  retryPipeline,
  runWorkflowAction,
  skipPipelineReview,
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
  // Copy only transport data: renderer can never supply a runtime lease or abort controller.
  return {
    projectId:
      typeof params.projectId === 'string' ? params.projectId : undefined,
    projectPath: assertRegisteredProjectRoot(params.projectPath),
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
  registerResultHandler(IPC.PIPELINE_PAUSE, () =>
    pausePipeline(getPipelineRuntime())
  )
  registerResultHandler(IPC.PIPELINE_ABORT, () =>
    abortPipeline(getPipelineRuntime())
  )
  registerResultHandler(IPC.PIPELINE_RESUME, () =>
    resumePipeline(getPipelineRuntime())
  )
  registerResultHandler(IPC.PIPELINE_RETRY, (stage) => {
    validateStage(stage)
    return retryPipeline(getPipelineRuntime(), stage)
  })
  registerResultHandler(IPC.PIPELINE_SKIP, (stage) => {
    validateStage(stage)
    return skipPipelineReview(getPipelineRuntime(), stage)
  })
  registerSafeIpcHandler(IPC.PIPELINE_GET_STATE, () =>
    getPipelineContext(getPipelineRuntime())
  )
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
