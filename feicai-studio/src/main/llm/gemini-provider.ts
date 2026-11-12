import { observeTextMetadata } from './text-metadata'
import { BaseLLMProvider } from './types'
import { LLMRequestError, normalizeBaseEndpoint } from './endpoint-security'
import {
  assertNonEmpty,
  assertResponseOK,
  modelEvents,
  providerFailure,
  requestJSON,
  RequestScope
} from './request-transport'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'

interface GeminiResponse {
  error?: unknown
  promptFeedback?: { blockReason?: string }
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  }>
}

export class GeminiProvider extends BaseLLMProvider {
  private readonly baseURL: string

  constructor(config: LLMConfig) {
    super(config)
    const base = normalizeBaseEndpoint(config.baseUrl)
    this.baseURL = /\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`
  }

  private async *execute(
    prompt: AssembledPrompt,
    options: GenerateOptions | undefined,
    stream: boolean
  ): AsyncGenerator<string> {
    const scope = new RequestScope(options)
    let output = ''
    try {
      const model = this.config.model.replace(/^models\//, '')
      const method = stream
        ? 'streamGenerateContent?alt=sse'
        : 'generateContent'
      const response = await requestJSON(
        `${this.baseURL}/models/${encodeURIComponent(model)}:${method}`,
        {
          'x-goog-api-key': this.config.apiKey,
          'Content-Type': 'application/json'
        },
        {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: {
            maxOutputTokens: this.getMaxTokens(options),
            temperature: this.getTemperature(options)
          }
        },
        scope
      )
      assertResponseOK(response)
      for await (const event of modelEvents(response, scope)) {
        const data = event.data as GeminiResponse | null
        if (!data || typeof data !== 'object')
          throw new LLMRequestError('模型响应结构无效')
        const candidate = data.candidates?.[0]
        observeTextMetadata(options, 'google', data, event.event)
        if (
          event.event === 'error' ||
          data.error ||
          data.promptFeedback?.blockReason ||
          (candidate?.finishReason &&
            !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(
              candidate.finishReason
            ))
        ) {
          throw new LLMRequestError('Gemini 模型返回错误或内容受到限制')
        }
        const text = (candidate?.content?.parts || [])
          .filter((part) => !part.thought)
          .map((part) => part.text || '')
          .join('')
        if (text) {
          scope.throwIfAborted()
          output += text
          options?.onChunk?.(text)
          yield text
        }
      }
      scope.throwIfAborted()
      assertNonEmpty(output)
    } catch (error) {
      throw providerFailure(error, scope)
    } finally {
      scope.dispose()
    }
  }

  async generate(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): Promise<string> {
    let text = ''
    for await (const chunk of this.execute(prompt, options, false))
      text += chunk
    return text
  }

  async *generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    yield* this.execute(prompt, options, true)
  }
}
