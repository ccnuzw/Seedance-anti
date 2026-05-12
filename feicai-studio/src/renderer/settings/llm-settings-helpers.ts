import type { LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'

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
