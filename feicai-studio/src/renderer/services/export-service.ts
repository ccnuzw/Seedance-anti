import type {
  ExportAllArtifactsParams,
  ExportPromptsParams
} from '@shared/ipc-contracts'
import type { ServiceExportResult } from './service-contracts'

export type ExportFormat = ExportPromptsParams['format']

export async function exportPrompts(
  params: ExportPromptsParams
): Promise<ServiceExportResult> {
  return await window.feicaiAPI.exportPrompts(params)
}

export async function exportAllArtifacts(
  params: ExportAllArtifactsParams
): Promise<ServiceExportResult> {
  return await window.feicaiAPI.exportAllArtifacts(params)
}
