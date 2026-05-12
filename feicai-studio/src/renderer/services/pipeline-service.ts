import type { AutomatedPipelineStage } from '@shared/types'
import type { PipelineStartParams } from './workflow-actions'
import type {
  ServicePipelineContext,
  ServicePipelineStartResult
} from './service-contracts'

export async function startPipeline(
  params: PipelineStartParams
): Promise<ServicePipelineStartResult> {
  return await window.feicaiAPI.startPipeline(params)
}

export async function runPipelineAndWait(
  params: PipelineStartParams
): Promise<ServicePipelineStartResult> {
  return await window.feicaiAPI.runPipelineAndWait(params)
}

export async function pausePipeline(): Promise<void> {
  await window.feicaiAPI.pausePipeline()
}

export async function abortPipeline(): Promise<void> {
  await window.feicaiAPI.abortPipeline()
}

export async function retryPipeline(
  stage?: AutomatedPipelineStage
): Promise<void> {
  await window.feicaiAPI.retryPipeline(stage)
}

export async function skipPipeline(): Promise<void> {
  await window.feicaiAPI.skipPipeline()
}

export async function getPipelineState(): Promise<ServicePipelineContext> {
  return await window.feicaiAPI.getPipelineState()
}

export const pipelineEvents = {
  onStateChanged: window.feicaiAPI.onPipelineStateChanged,
  onLog: window.feicaiAPI.onPipelineLog,
  onStream: window.feicaiAPI.onPipelineStream,
  onReviewResult: window.feicaiAPI.onPipelineReviewResult,
  onError: window.feicaiAPI.onPipelineError
}
