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

interface AnthropicEvent {
  type?: string
  error?: unknown
  content?: Array<{ type?: string; text?: string }>
  content_block?: { type?: string; text?: string }
  delta?: { type?: string; text?: string }
}

export class AnthropicProvider extends BaseLLMProvider {
  private readonly endpoint: string

  constructor(config: LLMConfig) {
    super(config)
    const base = normalizeBaseEndpoint(config.baseUrl)
    this.endpoint = `${base.endsWith('/v1') ? base : `${base}/v1`}/messages`
  }

  private async *execute(
    prompt: AssembledPrompt,
    options: GenerateOptions | undefined,
    stream: boolean
  ): AsyncGenerator<string> {
    const scope = new RequestScope(options)
    let output = ''
    try {
      const response = await requestJSON(
        this.endpoint,
        {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        {
          model: this.config.model,
          max_tokens: this.getMaxTokens(options),
          temperature: this.getTemperature(options),
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          stream
        },
        scope
      )
      assertResponseOK(response)
      for await (const event of modelEvents(response, scope)) {
        const data = event.data as AnthropicEvent | null
        if (!data || typeof data !== 'object')
          throw new LLMRequestError('模型响应结构无效')
        const type = data.type || event.event
        observeTextMetadata(options, 'anthropic', data, event.event)
        if (event.event === 'error' || type === 'error' || data.error)
          throw new LLMRequestError('Anthropic 模型流返回错误')
        let text = ''
        if (event.event === 'json')
          text = (data.content || [])
            .filter((part) => part.type === 'text')
            .map((part) => part.text || '')
            .join('')
        else if (
          type === 'content_block_delta' &&
          data.delta?.type === 'text_delta'
        )
          text = data.delta.text || ''
        else if (
          type === 'content_block_start' &&
          data.content_block?.type === 'text'
        )
          text = data.content_block.text || ''
        if (text) {
          scope.throwIfAborted()
          output += text
          options?.onChunk?.(text)
          yield text
        }
        if (type === 'message_stop') break
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
