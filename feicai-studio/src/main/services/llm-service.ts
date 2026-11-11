import type {
  LLMConnectionTestResult,
  LLMModelInfo,
  LLMModelListRequest,
  LLMModelListResult
} from '@shared/ipc-contracts'
import type { LLMConfig } from '@shared/types'
import { createProvider } from '../llm/provider-factory'
import {
  LLMRequestError,
  normalizeBaseEndpoint,
  openAIBaseEndpoint,
  safeLLMError
} from '../llm/endpoint-security'
import {
  assertResponseOK,
  providerFailure,
  readJSON,
  requestJSON,
  RequestScope
} from '../llm/request-transport'
import {
  addLLMConfig as addLLMConfigRecord,
  deleteLLMConfig as deleteLLMConfigRecord,
  listLLMConfigs as listLLMConfigRecords,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfig as updateLLMConfigRecord
} from '../db/queries'

interface ModelsResponse {
  data?: Array<{ id: string; display_name?: string; owned_by?: string }>
  models?: Array<{ name: string; displayName?: string }>
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
  if (config.category === 'video') {
    return {
      success: false,
      message: '视频配置仅供记录，尚未提供视频生成生产链或连接测试'
    }
  }
  try {
    const provider = createProvider(resolveLLMConfigForExecution(config))
    return await provider.testConnection()
  } catch (error) {
    return { success: false, message: safeLLMError(error) }
  }
}

function resolveModelListConfig(payload: LLMModelListRequest): LLMConfig {
  const stored =
    payload.configId && !payload.apiKey?.trim()
      ? listLLMConfigRecords().find((config) => config.id === payload.configId)
      : undefined
  if (payload.configId && !payload.apiKey?.trim() && !stored)
    throw new LLMRequestError('模型配置不存在')
  const config: LLMConfig = {
    id: payload.configId || '',
    name: '',
    category: 'llm',
    provider: payload.provider ?? stored?.provider ?? 'openai-compatible',
    baseUrl: payload.baseUrl,
    apiKey: payload.apiKey?.trim() || '',
    model: '',
    maxTokens: 8192,
    temperature: 0.7,
    isDefault: false
  }
  return config.apiKey ? config : resolveLLMConfigForExecution(config)
}

export async function listLLMModels(
  payload: LLMModelListRequest
): Promise<LLMModelListResult> {
  const scope = new RequestScope()
  try {
    normalizeBaseEndpoint(payload.baseUrl)
    const config = resolveModelListConfig(payload)
    if (!config.apiKey.trim())
      throw new LLMRequestError('缺少 API Key，请重新填写并保存密钥')
    const base = normalizeBaseEndpoint(payload.baseUrl)
    let endpoint = `${openAIBaseEndpoint(payload.baseUrl)}/models`
    let headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`
    }
    if (config.provider === 'anthropic') {
      endpoint = `${base.endsWith('/v1') ? base : `${base}/v1`}/models`
      headers = {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      }
    } else if (config.provider === 'google') {
      endpoint = `${/\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`}/models`
      headers = { 'x-goog-api-key': config.apiKey }
    }
    const response = await requestJSON(endpoint, headers, undefined, scope)
    assertResponseOK(response)
    const data = (await readJSON(response, scope)) as ModelsResponse
    const models: LLMModelInfo[] =
      config.provider === 'google'
        ? (data.models || []).map((model) => ({
            id: model.name.replace(/^models\//, ''),
            name: model.displayName || model.name,
            owner: 'Google'
          }))
        : (data.data || []).map((model) => ({
            id: model.id,
            name: model.display_name || model.id,
            owner: model.owned_by || ''
          }))
    return { success: true, models, message: `获取到 ${models.length} 个模型` }
  } catch (error) {
    return {
      success: false,
      models: [],
      message: safeLLMError(providerFailure(error, scope))
    }
  } finally {
    scope.dispose()
  }
}
