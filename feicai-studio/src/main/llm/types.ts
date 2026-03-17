// ============================================================
// LLM Provider — 统一接口与类型定义
// ============================================================

import type { AssembledPrompt, GenerateOptions, LLMConfig, LLMProviderType } from '@shared/types'

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
  testConnection(): Promise<{ success: boolean; message: string; model?: string }>
}

/**
 * Provider 通用基类
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  readonly name: string
  readonly providerType: LLMProviderType
  protected config: LLMConfig

  constructor(config: LLMConfig) {
    this.name = config.name
    this.providerType = config.provider
    this.config = config
  }

  abstract generate(prompt: AssembledPrompt, options?: GenerateOptions): Promise<string>
  abstract generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown>
  abstract testConnection(): Promise<{ success: boolean; message: string; model?: string }>

  protected getMaxTokens(options?: GenerateOptions): number {
    return options?.maxTokens ?? this.config.maxTokens ?? 8192
  }

  protected getTemperature(options?: GenerateOptions): number {
    return options?.temperature ?? this.config.temperature ?? 0.7
  }
}
