import type {
  PipelineStartParams,
  PipelineStartResult,
  WorkflowActionParams,
  WorkflowActionResult
} from '@shared/ipc-contracts'
import type {
  ServicePipelineStartResult,
  ServiceWorkflowActionResult
} from './service-contracts'

export async function runStoryGeneration(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runStoryGeneration(params)
}

export async function runStoryReview(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runStoryReview(params)
}

export async function runScriptGeneration(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runScriptGeneration(params)
}

export async function runScriptReview(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runScriptReview(params)
}

export async function runCharacterDesign(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runCharacterDesign(params)
}

export async function runStoryboardReview(
  params: WorkflowActionParams
): Promise<ServiceWorkflowActionResult> {
  return await window.feicaiAPI.runStoryboardReview(params)
}

export async function startPipeline(
  params: PipelineStartParams
): Promise<ServicePipelineStartResult> {
  return await window.feicaiAPI.startPipeline(params)
}

export type {
  PipelineStartParams,
  PipelineStartResult,
  WorkflowActionParams,
  WorkflowActionResult
}
