import type {
  BasicSuccessResult,
  ExportResult,
  FileDialogFilter,
  LLMConnectionTestResult,
  LLMModelInfo,
  LLMModelListRequest,
  LLMModelListResult,
  PipelineStartResult,
  AssetUpdatePromptParams,
  WorkflowActionResult
} from '@shared/ipc-contracts'
import type {
  Character,
  LLMConfig,
  PipelineContext,
  ProjectPipelineState,
  Scene
} from '@shared/types'

export type ServiceBasicSuccessResult = BasicSuccessResult | void
export type ServiceFileDialogFilter = FileDialogFilter
export type ServiceLLMConnectionTestResult = LLMConnectionTestResult
export type ServiceLLMModelInfo = LLMModelInfo
export type ServiceLLMModelListRequest = LLMModelListRequest
export type ServiceLLMModelListResult = LLMModelListResult
export type ServicePipelineStartResult = PipelineStartResult
export type ServiceWorkflowActionResult = WorkflowActionResult
export type ServicePipelineContext = PipelineContext
export type ServiceProjectPipelineState = ProjectPipelineState | null
export type ServiceAssetUpdatePromptParams = AssetUpdatePromptParams
export type ServiceAssetUpdatePromptResult = BasicSuccessResult & {
  error?: string
}
export type ServiceExportResult = ExportResult
export type ServiceLLMConfigInput = Omit<LLMConfig, 'id'>
export type ServiceLLMConfigUpdate = Partial<Omit<LLMConfig, 'id'>>
export type ServiceCharacterList = Character[]
export type ServiceSceneList = Scene[]

export function isServiceSuccess(result: { success?: boolean }): boolean {
  return result.success === true
}

export function getServiceErrorMessage(
  result: { error?: string; message?: string },
  fallback: string
): string {
  return result.error || result.message || fallback
}

export function getServiceFailureToast(
  result: { error?: string; message?: string },
  fallback: string
): { type: 'error'; message: string } {
  return {
    type: 'error',
    message: getServiceErrorMessage(result, fallback)
  }
}

export function getExceptionMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
