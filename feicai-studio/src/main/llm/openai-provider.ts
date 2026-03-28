// ============================================================
// OpenAI Provider — OpenAI / OpenAI-Compatible API 实现
// 支持 OpenAI 官方、Ollama、LM Studio 等兼容协议
// ============================================================

import OpenAI from 'openai'
import { BaseLLMProvider } from './types'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'
import { buildEstimatedUsage } from './telemetry'

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
    }, {
      signal: options?.signal
    })

    const text = completion.choices[0]?.message?.content || ''
    const estimated = buildEstimatedUsage(prompt.system, prompt.user, text)
    options?.onChunk?.(text)
    this.emitTelemetry(options, {
      inputTokens: completion.usage?.prompt_tokens ?? estimated.inputTokens,
      outputTokens: completion.usage?.completion_tokens ?? estimated.outputTokens,
      totalTokens: completion.usage?.total_tokens ?? estimated.totalTokens,
      tokenSource: completion.usage ? 'actual' : 'estimated'
    })
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
      stream: true,
      stream_options: {
        include_usage: true
      }
    }, {
      signal: options?.signal
    })

    let output = ''
    let finalUsage:
      | {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      | undefined

    for await (const chunk of stream) {
      if (chunk.usage) {
        finalUsage = chunk.usage
      }
      const text = chunk.choices[0]?.delta?.content
      if (text) {
        output += text
        options?.onChunk?.(text)
        yield text
      }
    }

    const estimated = buildEstimatedUsage(prompt.system, prompt.user, output)
    this.emitTelemetry(options, {
      inputTokens: finalUsage?.prompt_tokens ?? estimated.inputTokens,
      outputTokens: finalUsage?.completion_tokens ?? estimated.outputTokens,
      totalTokens: finalUsage?.total_tokens ?? estimated.totalTokens,
      tokenSource: finalUsage ? 'actual' : 'estimated'
    })
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
