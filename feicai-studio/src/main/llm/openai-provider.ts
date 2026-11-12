// OpenAI / compatible native-fetch adapter. All retries share one cancellation scope.
import { observeTextMetadata } from './text-metadata'
import { BaseLLMProvider, resolveTextWireParameters } from './types'
import {
  LLMRequestError,
  openAIBaseEndpoint,
  safeLLMError
} from './endpoint-security'
import {
  assertNonEmpty,
  assertResponseOK,
  modelEvents,
  providerFailure,
  readJSON,
  requestJSON,
  RequestScope
} from './request-transport'
import type { AssembledPrompt, GenerateOptions, LLMConfig } from '@shared/types'

interface OpenAIResponse {
  type?: string
  status?: string
  error?: unknown
  delta?: string
  text?: string
  output_index?: number
  content_index?: number
  response?: OpenAIResponse
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  choices?: Array<{
    delta?: { content?: string | Array<{ text?: string }> }
    message?: { content?: string | Array<{ text?: string }> }
  }>
}

function contentText(
  content: string | Array<{ text?: string }> | undefined
): string {
  return typeof content === 'string'
    ? content
    : (content || []).map((part) => part.text || '').join('')
}

function responseText(data: OpenAIResponse): string {
  return (
    data.output_text ||
    (data.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text || '')
      .join('')
  )
}

export class OpenAIProvider extends BaseLLMProvider {
  private readonly baseURL: string

  constructor(config: LLMConfig) {
    super(config)
    this.baseURL = openAIBaseEndpoint(config.baseUrl)
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json'
    }
  }

  private body(
    prompt: AssembledPrompt,
    options: GenerateOptions | undefined,
    stream: boolean
  ): Record<string, unknown> {
    const responses = this.config.wireApi === 'responses'
    const parameters = resolveTextWireParameters(this.config, options)
    const body: Record<string, unknown> = responses
      ? {
          model: this.config.model,
          instructions: prompt.system,
          input: [{ role: 'user', content: prompt.user }],
          max_output_tokens: parameters.maxTokens,
          stream
        }
      : {
          model: this.config.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          max_tokens: parameters.maxTokens,
          stream
        }
    if (
      responses &&
      this.config.provider === 'openai' &&
      this.config.reasoningEffort !== 'none'
    ) {
      body.reasoning = { effort: this.config.reasoningEffort || 'medium' }
    }
    if (parameters.temperature !== undefined)
      body.temperature = parameters.temperature
    return body
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    scope: RequestScope
  ): Promise<Response> {
    const response = await requestJSON(
      `${this.baseURL}${path}`,
      this.headers(),
      body,
      scope
    )
    if (response.ok) return response
    // A single compatibility retry, only for a named parameter actually sent.
    if (response.status === 400) {
      const data = (await readJSON(response, scope)) as {
        detail?: string
        error?: { message?: string }
      }
      const detail =
        typeof data.detail === 'string' ? data.detail : data.error?.message
      const parameter =
        typeof detail === 'string'
          ? /Unsupported parameter:\s*['"]?([\w.-]+)['"]?/i.exec(detail)?.[1]
          : undefined
      if (parameter && Object.hasOwn(body, parameter)) {
        const retryBody = { ...body }
        delete retryBody[parameter]
        const retry = await requestJSON(
          `${this.baseURL}${path}`,
          this.headers(),
          retryBody,
          scope
        )
        assertResponseOK(retry)
        return retry
      }
    }
    assertResponseOK(response)
    return response
  }

  private async *execute(
    prompt: AssembledPrompt,
    options: GenerateOptions | undefined,
    stream: boolean
  ): AsyncGenerator<string> {
    const scope = new RequestScope(options)
    let emitted = ''
    const blocks = new Map<string, string>()
    try {
      const responses = this.config.wireApi === 'responses'
      const response = await this.request(
        responses ? '/responses' : '/chat/completions',
        this.body(prompt, options, stream),
        scope
      )
      for await (const event of modelEvents(response, scope)) {
        scope.throwIfAborted()
        const data = event.data as OpenAIResponse | null
        if (!data || typeof data !== 'object')
          throw new LLMRequestError('模型响应结构无效')
        const type = data.type || event.event
        observeTextMetadata(options, 'openai', data, event.event)
        if (
          data.error ||
          data.response?.error ||
          event.event === 'error' ||
          ['failed', 'incomplete'].includes(
            data.response?.status || data.status || ''
          ) ||
          /(?:^error$|\.failed$|\.incomplete$|\.error$)/.test(type)
        ) {
          throw new LLMRequestError(
            '模型流返回错误或未完成，请检查模型与请求设置'
          )
        }
        let text = ''
        if (!responses) {
          text = contentText(
            data.choices?.[0]?.delta?.content ??
              data.choices?.[0]?.message?.content
          )
        } else if (type === 'response.output_text.delta') {
          text = data.delta || ''
          const key = `${data.output_index ?? 0}:${data.content_index ?? 0}`
          blocks.set(key, (blocks.get(key) || '') + text)
        } else if (type === 'response.output_text.done') {
          const key = `${data.output_index ?? 0}:${data.content_index ?? 0}`
          const previous = blocks.get(key) || ''
          if (data.text && !data.text.startsWith(previous))
            throw new LLMRequestError('模型流文本与最终结果不一致')
          text = (data.text || '').slice(previous.length)
          blocks.set(key, data.text || previous)
        } else if (type === 'response.completed' || event.event === 'json') {
          const finalText = responseText(data.response || data)
          if (finalText && !finalText.startsWith(emitted))
            throw new LLMRequestError('模型流文本与最终结果不一致')
          text = finalText.slice(emitted.length)
        }
        if (text) {
          emitted += text
          options?.onChunk?.(text)
          yield text
        }
        if (type === 'response.completed') break
      }
      scope.throwIfAborted()
      assertNonEmpty(emitted)
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

  async testConnection(): Promise<{
    success: boolean
    message: string
    model?: string
  }> {
    if (this.config.category === 'video')
      return {
        success: false,
        message: '视频配置仅供记录，尚未提供视频生成生产链或连接测试'
      }
    try {
      if (this.config.category === 'image') {
        const scope = new RequestScope()
        try {
          const response = await this.request(
            '/images/generations',
            {
              model: this.config.model,
              prompt: 'A red apple on a white background',
              size: this.config.imageSize || '1024x1024',
              quality: this.config.imageQuality || 'auto',
              output_format: this.config.imageOutputFormat || 'png',
              background: this.config.imageBackground || 'auto'
            },
            scope
          )
          const data = (await readJSON(response, scope)) as {
            data?: Array<{ b64_json?: string; url?: string }>
          }
          if (!data.data?.some((image) => image.b64_json || image.url))
            throw new LLMRequestError('图片测试未返回图片结果')
          return {
            success: true,
            message:
              '真实图片生成测试成功（服务商可能已计费）；工作台尚未提供图片生成生产链',
            model: this.config.model
          }
        } catch (error) {
          throw providerFailure(error, scope)
        } finally {
          scope.dispose()
        }
      }
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
}
