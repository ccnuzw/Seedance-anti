// ============================================================
// Provider Factory — 根据配置创建对应的 LLM Provider
// ============================================================

import type { LLMConfig } from '@shared/types'
import type { ILLMProvider } from './types'
import { GeminiProvider } from './gemini-provider'
import { AnthropicProvider } from './anthropic-provider'
import { OpenAIProvider } from './openai-provider'

/**
 * 根据 LLMConfig 创建对应的 Provider 实例
 */
export function createProvider(config: LLMConfig): ILLMProvider {
  switch (config.provider) {
    case 'google':
      return new GeminiProvider(config)
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai':
    case 'openai-compatible':
      return new OpenAIProvider(config)
    default:
      throw new Error(`不支持的 LLM Provider 类型: ${config.provider}`)
  }
}
