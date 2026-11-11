import type { LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'
import type { LLMFormState } from './llm-config'

export function updateCredentialDraft(
  previous: LLMFormState,
  next: LLMFormState,
  hasStoredApiKey: boolean
): { form: LLMFormState; hasStoredApiKey: boolean } {
  if (
    previous.provider !== next.provider ||
    previous.baseUrl !== next.baseUrl
  ) {
    return { form: { ...next, apiKey: '' }, hasStoredApiKey: false }
  }
  return { form: next, hasStoredApiKey }
}

export function modelTestNotice(category: ModelCategory): string {
  if (category === 'video')
    return '视频配置仅供记录，尚未提供视频生成生产链或连接测试。'
  if (category === 'image')
    return '测试会发送真实图片生成请求，服务商可能收费。工作台尚未提供图片生成生产链。'
  return '测试会发送真实文本生成请求，服务商可能收费。'
}

export function isOpenAIProvider(provider: LLMProviderType): boolean {
  return provider === 'openai' || provider === 'openai-compatible'
}

export function hasUsableApiKey(
  apiKey: string,
  editingId: string | null,
  hasStoredApiKey: boolean
): boolean {
  return !!apiKey.trim() || !!(editingId && hasStoredApiKey)
}

export function canFetchModelList(params: {
  apiKey: string
  editingId: string | null
  hasStoredApiKey: boolean
  baseUrl: string
  fetchingModels: boolean
}): boolean {
  return (
    !params.fetchingModels &&
    hasUsableApiKey(params.apiKey, params.editingId, params.hasStoredApiKey) &&
    !!params.baseUrl
  )
}

export function canTestConnection(params: {
  apiKey: string
  editingId: string | null
  hasStoredApiKey: boolean
  model: string
  testing: boolean
}): boolean {
  return (
    !params.testing &&
    hasUsableApiKey(params.apiKey, params.editingId, params.hasStoredApiKey) &&
    !!params.model
  )
}

export function canSaveConfig(params: {
  name: string
  apiKey: string
  editingId: string | null
  hasStoredApiKey: boolean
  model: string
}): boolean {
  return (
    !!params.name &&
    hasUsableApiKey(params.apiKey, params.editingId, params.hasStoredApiKey) &&
    !!params.model
  )
}

export function formatImageConfigSummary(
  config: LLMConfig,
  defaults: {
    imageSize: string
    imageQuality: string
    imageOutputFormat: string
    imageBackground: string
  }
): string {
  return [
    config.imageSize || defaults.imageSize,
    config.imageQuality || defaults.imageQuality,
    config.imageOutputFormat || defaults.imageOutputFormat,
    config.imageBackground || defaults.imageBackground
  ].join(' · ')
}

export function countConfigsByCategory(
  configs: LLMConfig[],
  category: ModelCategory
): number {
  return configs.filter((config) => (config.category || 'llm') === category)
    .length
}
