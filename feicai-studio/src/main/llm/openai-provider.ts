// ============================================================
// OpenAI Provider — OpenAI / OpenAI-Compatible API 实现
// 支持 OpenAI 官方、Ollama、LM Studio 等兼容协议
// ============================================================

import OpenAI from 'openai'
import { BaseLLMProvider } from './types'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI

  constructor(config: LLMConfig) {
    super(config)
    // 自动补全 /v1 后缀
    let baseURL = config.baseUrl.replace(/\/+$/, '')
    if (!baseURL.endsWith('/v1')) baseURL += '/v1'
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL,
      defaultHeaders: {
        'User-Agent': 'FEICAI-Studio/0.1.0',
        'Accept': 'application/json',
      },
      // 使用 Node.js 原生 fetch 绕过 Cloudflare 对 OpenAI SDK UA 的拦截
      fetch: globalThis.fetch
    })
  }

  async generate(prompt: AssembledPrompt, options?: GenerateOptions): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      max_tokens: this.getMaxTokens(options),
      temperature: this.getTemperature(options)
    })

    const text = completion.choices[0]?.message?.content || ''
    options?.onChunk?.(text)
    return text
  }

  async *generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      max_tokens: this.getMaxTokens(options),
      temperature: this.getTemperature(options),
      stream: true
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) {
        options?.onChunk?.(text)
        yield text
      }
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'Reply with: OK' }],
        max_tokens: 10
      })
      const text = completion.choices[0]?.message?.content || ''
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
