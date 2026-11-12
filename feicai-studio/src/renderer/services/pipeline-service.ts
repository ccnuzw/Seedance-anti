import { assertExecutionAvailable } from './task-center-admission'
import type { AutomatedPipelineStage } from '@shared/types'
import type {
  PipelineControlTarget,
  PipelineTaskControl,
  PipelineTaskSnapshot
} from '@shared/pipeline-task'
import type { PipelineStartParams } from './workflow-actions'
import type { ExecutionStatus } from '@shared/ipc-contracts'
import type {
  ServicePipelineContext,
  ServicePipelineStartResult
} from './service-contracts'

export async function startPipeline(
  params: PipelineStartParams
): Promise<ServicePipelineStartResult> {
  await assertExecutionAvailable()
  return await window.feicaiAPI.startPipeline(params)
}

export async function runPipelineAndWait(
  params: PipelineStartParams
): Promise<ServicePipelineStartResult> {
  await assertExecutionAvailable()
  return await window.feicaiAPI.runPipelineAndWait(params)
}

function assertControlResult(
  result: { success: boolean; error?: string } | void
): void {
  if (result && !result.success) throw new Error(result.error || '任务控制失败')
}

export async function pausePipeline(
  target?: PipelineControlTarget
): Promise<void> {
  assertControlResult(
    await (target
      ? window.feicaiAPI.pausePipeline(target)
      : window.feicaiAPI.pausePipeline())
  )
}

export async function abortPipeline(
  target?: PipelineControlTarget
): Promise<void> {
  assertControlResult(
    await (target
      ? window.feicaiAPI.abortPipeline(target)
      : window.feicaiAPI.abortPipeline())
  )
}

export async function retryPipeline(
  stage?: AutomatedPipelineStage,
  target?: PipelineControlTarget
): Promise<void> {
  await assertExecutionAvailable()
  assertControlResult(
    await window.feicaiAPI.retryPipeline(target ? { stage, target } : stage)
  )
}

export async function skipPipeline(
  target?: PipelineControlTarget
): Promise<void> {
  assertControlResult(
    await (target
      ? window.feicaiAPI.skipPipeline({ target })
      : window.feicaiAPI.skipPipeline())
  )
}

export async function getExecutionStatus(): Promise<ExecutionStatus> {
  return await window.feicaiAPI.getExecutionStatus()
}

export async function listPipelineTasks(): Promise<PipelineTaskSnapshot[]> {
  return await window.feicaiAPI.listPipelineTasks()
}

export async function controlPipelineTask(
  request: PipelineTaskControl
): Promise<void> {
  if (request.action === 'retry') await assertExecutionAvailable()
  assertControlResult(await window.feicaiAPI.controlPipelineTask(request))
}

export async function getPipelineState(): Promise<ServicePipelineContext> {
  return await window.feicaiAPI.getPipelineState()
}

export const pipelineEvents = {
  onTaskChanged: window.feicaiAPI.onPipelineTaskChanged,
  onStateChanged: window.feicaiAPI.onPipelineStateChanged,
  onLog: window.feicaiAPI.onPipelineLog,
  onStream: window.feicaiAPI.onPipelineStream,
  onReviewResult: window.feicaiAPI.onPipelineReviewResult,
  onError: window.feicaiAPI.onPipelineError
}
