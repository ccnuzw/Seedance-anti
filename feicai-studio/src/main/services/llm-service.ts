import type {
  LLMConnectionTestResult,
  LLMModelInfo,
  LLMModelListRequest,
  LLMModelListResult
} from '@shared/ipc-contracts'
import type { LLMConfig } from '@shared/types'
import { createProvider } from '../llm/provider-factory'
import {
  addLLMConfig as addLLMConfigRecord,
  deleteLLMConfig as deleteLLMConfigRecord,
  listLLMConfigs as listLLMConfigRecords,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfig as updateLLMConfigRecord
} from '../db/queries'

interface OpenAIModelsResponse {
  data?: Array<{
    id: string
    display_name?: string
    owned_by?: string
  }>
}

export function listLLMConfigs(): LLMConfig[] {
  return listLLMConfigRecords()
}

export function addLLMConfig(data: Omit<LLMConfig, 'id'>): LLMConfig {
  return addLLMConfigRecord(data)
}

export function deleteLLMConfig(id: string): void {
  deleteLLMConfigRecord(id)
}

export function updateLLMConfig(
  id: string,
  data: Partial<Omit<LLMConfig, 'id'>>
): void {
  updateLLMConfigRecord(id, data)
}

export function setDefaultLLM(id: string): void {
  setDefaultLLMConfig(id)
}

export async function testLLMConnection(
  config: LLMConfig
): Promise<LLMConnectionTestResult> {
  try {
    const provider = createProvider(resolveLLMConfigForExecution(config))
    return await provider.testConnection()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, message }
  }
}

function resolveModelListApiKey(payload: LLMModelListRequest): string {
  if (payload.apiKey?.trim()) {
    return payload.apiKey.trim()
  }

  if (!payload.configId) {
    return ''
  }

  const resolvedConfig = resolveLLMConfigForExecution({
    id: payload.configId,
    name: '',
    category: 'llm',
    provider: 'openai-compatible',
    baseUrl: payload.baseUrl,
    apiKey: '',
    model: '',
    maxTokens: 8192,
    temperature: 0.7,
    isDefault: false
  })

  return resolvedConfig.apiKey.trim()
}

function normalizeModelsEndpoint(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '')
  if (!url.endsWith('/v1')) {
    url += '/v1'
  }
  return `${url}/models`
}

function toModelInfoList(data: OpenAIModelsResponse): LLMModelInfo[] {
  return (data.data || []).map((model) => ({
    id: model.id,
    name: model.display_name || model.id,
    owner: model.owned_by || ''
  }))
}

export async function listLLMModels(
  payload: LLMModelListRequest
): Promise<LLMModelListResult> {
  try {
    const apiKey = resolveModelListApiKey(payload)
    if (!apiKey) {
      return { success: false, models: [], message: '缺少 API Key' }
    }

    const response = await fetch(normalizeModelsEndpoint(payload.baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` }
    })

    if (!response.ok) {
      return {
        success: false,
        models: [],
        message: `HTTP ${response.status}: ${response.statusText}`
      }
    }

    const data = (await response.json()) as OpenAIModelsResponse
    const models = toModelInfoList(data)

    return {
      success: true,
      models,
      message: `获取到 ${models.length} 个模型`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, models: [], message: `获取失败: ${message}` }
  }
}
