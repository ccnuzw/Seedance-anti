// ============================================================
// Anthropic Provider — Claude API 实现
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { BaseLLMProvider } from './types'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'

export class AnthropicProvider extends BaseLLMProvider {
  private client: Anthropic

  constructor(config: LLMConfig) {
    super(config)
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || undefined
    })
  }

  async generate(prompt: AssembledPrompt, options?: GenerateOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.getMaxTokens(options),
      temperature: this.getTemperature(options),
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('')

    options?.onChunk?.(text)
    return text
  }

  async *generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.getMaxTokens(options),
      temperature: this.getTemperature(options),
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const text = event.delta.text
        if (text) {
          options?.onChunk?.(text)
          yield text
        }
      }
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with: OK' }]
      })
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('')
      return {
        success: true,
        message: `连接成功，模型响应: ${text.substring(0, 50)}`,
        model: this.config.model
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: `连接失败: ${msg}` }
    }
  }
}
