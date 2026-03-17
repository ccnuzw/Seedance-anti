// ============================================================
// Gemini Provider — Google Gemini API 实现
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai'
import { BaseLLMProvider } from './types'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'

export class GeminiProvider extends BaseLLMProvider {
  private client: GoogleGenerativeAI

  constructor(config: LLMConfig) {
    super(config)
    this.client = new GoogleGenerativeAI(config.apiKey)
  }

  async generate(prompt: AssembledPrompt, options?: GenerateOptions): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.config.model,
      systemInstruction: prompt.system
    })

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        maxOutputTokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options)
      }
    })

    const text = result.response.text()
    options?.onChunk?.(text)
    return text
  }

  async *generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    const model = this.client.getGenerativeModel({
      model: this.config.model,
      systemInstruction: prompt.system
    })

    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        maxOutputTokens: this.getMaxTokens(options),
        temperature: this.getTemperature(options)
      }
    })

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        options?.onChunk?.(text)
        yield text
      }
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      const model = this.client.getGenerativeModel({ model: this.config.model })
      const result = await model.generateContent('Reply with: OK')
      const text = result.response.text()
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
