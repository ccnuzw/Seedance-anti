// ============================================================
// LLM Provider — 统一接口与类型定义
// ============================================================

import type {
  AssembledPrompt,
  GenerateOptions,
  LLMConfig,
  LLMProviderType
} from '@shared/types'
import {
  LLMRequestError,
  normalizeBaseEndpoint,
  safeLLMError
} from './endpoint-security'

/**
 * LLM Provider 统一接口
 * 所有 Provider 实现都必须实现此接口
 */
export interface ILLMProvider {
  readonly name: string
  readonly providerType: LLMProviderType

  /** 非流式生成 */
  generate(prompt: AssembledPrompt, options?: GenerateOptions): Promise<string>

  /** 流式生成 */
  generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown>

  /** 测试连接 */
  testConnection(): Promise<{
    success: boolean
    message: string
    model?: string
  }>
}

/**
 * Provider 通用基类
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  readonly name: string
  readonly providerType: LLMProviderType
  protected config: LLMConfig

  constructor(config: LLMConfig) {
    normalizeBaseEndpoint(config.baseUrl)
    if (!config.apiKey.trim())
      throw new LLMRequestError('缺少 API Key，请重新填写并保存密钥')
    this.name = config.name
    this.providerType = config.provider
    this.config = config
  }

  abstract generate(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): Promise<string>
  abstract generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown>
  async testConnection(): Promise<{
    success: boolean
    message: string
    model?: string
  }> {
    if (this.config.category !== 'llm' && this.config.category !== undefined) {
      return {
        success: false,
        message: '此配置尚未提供图片或视频生成生产链及连接测试'
      }
    }
    try {
      await this.generate(
        { system: 'Reply with OK', user: 'Reply with OK' },
        { maxTokens: 32 }
      )
      return {
        success: true,
        message: '真实文本生成测试成功（服务商可能已计费）',
        model: this.config.model
      }
    } catch (error) {
      return { success: false, message: safeLLMError(error) }
    }
  }

  protected getMaxTokens(options?: GenerateOptions): number {
    return options?.maxTokens ?? this.config.maxTokens ?? 8192
  }

  protected getTemperature(options?: GenerateOptions): number {
    return options?.temperature ?? this.config.temperature ?? 0.7
  }
}
