import type { LLMConfig, ModelCategory } from '@shared/types'
import type {
  ServiceBasicSuccessResult,
  ServiceLLMConfigInput,
  ServiceLLMConfigUpdate,
  ServiceLLMConnectionTestResult,
  ServiceLLMModelInfo,
  ServiceLLMModelListRequest,
  ServiceLLMModelListResult
} from './service-contracts'

export async function listLLMConfigs(): Promise<LLMConfig[]> {
  return await window.feicaiAPI.listLLMConfigs()
}

export async function addLLMConfig(
  data: ServiceLLMConfigInput
): Promise<LLMConfig> {
  return await window.feicaiAPI.addLLMConfig(data)
}

export async function updateLLMConfig(
  id: string,
  data: ServiceLLMConfigUpdate
): Promise<ServiceBasicSuccessResult> {
  return await window.feicaiAPI.updateLLMConfig(id, data)
}

export async function deleteLLMConfig(
  id: string
): Promise<ServiceBasicSuccessResult> {
  return await window.feicaiAPI.deleteLLMConfig(id)
}

export async function setDefaultLLM(
  id: string
): Promise<ServiceBasicSuccessResult> {
  return await window.feicaiAPI.setDefaultLLM(id)
}

export async function testLLMConnection(
  config: LLMConfig
): Promise<ServiceLLMConnectionTestResult> {
  return await window.feicaiAPI.testLLMConnection(config)
}

export async function listLLMModels(
  payload: ServiceLLMModelListRequest
): Promise<ServiceLLMModelListResult> {
  return await window.feicaiAPI.listLLMModels(payload)
}

export function normalizeConfigCategory(
  category?: ModelCategory
): ModelCategory {
  return category || 'llm'
}

export type {
  ServiceLLMConnectionTestResult as LLMConnectionTestResult,
  ServiceLLMModelInfo as LLMModelInfo,
  ServiceLLMModelListRequest as LLMModelListRequest
}
