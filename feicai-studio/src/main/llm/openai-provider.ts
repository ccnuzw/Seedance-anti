// ============================================================
// OpenAI Provider — OpenAI / OpenAI-Compatible API 实现
// 支持 chat/completions 和 responses 两种线协议
// ============================================================

import { BaseLLMProvider } from './types'
import type {
  AssembledPrompt,
  GenerateOptions,
  LLMConfig,
  OpenAIWireApi
} from '@shared/types'

export class OpenAIProvider extends BaseLLMProvider {
  private baseURL: string
  private wireApi: OpenAIWireApi
  private static readonly IMAGE_TEST_PROMPT =
    'A red apple on a white background'

  constructor(config: LLMConfig) {
    super(config)
    let baseURL = config.baseUrl.replace(/\/+$/, '')
    if (!baseURL.endsWith('/v1')) baseURL += '/v1'
    this.baseURL = baseURL
    this.wireApi = config.wireApi || 'chat-completions'
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'FEICAI-Studio/0.1.0'
    }
  }

  private async readResponseDetail(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type') || ''

    try {
      if (contentType.includes('application/json')) {
        const data = (await response.json()) as {
          detail?: string
          error?: { message?: string; type?: string; code?: string }
          message?: string
        }
        const parts = [
          data.detail,
          data.error?.message,
          data.message,
          data.error?.type ? `type=${data.error.type}` : '',
          data.error?.code ? `code=${data.error.code}` : ''
        ].filter(Boolean)

        if (parts.length > 0) return parts.join(' | ')
        return JSON.stringify(data).slice(0, 300)
      }

      const text = (await response.text()).trim()
      return text ? text.slice(0, 300) : '(empty body)'
    } catch {
      return '(无法解析响应内容)'
    }
  }

  private async request(
    path: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    return fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body)
    })
  }

  private shouldSendTemperature(options?: GenerateOptions): boolean {
    return this.config.provider === 'openai' || options?.temperature !== undefined
  }

  private applyTemperature(
    body: Record<string, unknown>,
    options?: GenerateOptions
  ): Record<string, unknown> {
    if (!this.shouldSendTemperature(options)) return body
    return { ...body, temperature: this.getTemperature(options) }
  }

  private getUnsupportedParameter(detail: string): string | null {
    const match = detail.match(/Unsupported parameter:\s*['"]?([\w.-]+)['"]?/i)
    return match?.[1] || null
  }

  private async requestWithUnsupportedParameterRetry(
    path: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const response = await this.request(path, body)
    if (response.ok) return response

    const detail = await this.readResponseDetail(response)
    const parameter = this.getUnsupportedParameter(detail)
    if (parameter && Object.hasOwn(body, parameter)) {
      const retryBody = { ...body }
      delete retryBody[parameter]
      const retryResponse = await this.request(path, retryBody)
      if (retryResponse.ok) return retryResponse

      const retryDetail = await this.readResponseDetail(retryResponse)
      throw new Error(`HTTP ${retryResponse.status}: ${retryDetail}`)
    }

    throw new Error(`HTTP ${response.status}: ${detail}`)
  }

  private buildResponsesBody(
    prompt: AssembledPrompt,
    options?: GenerateOptions,
    stream = false
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      instructions: prompt.system,
      input: [{ role: 'user', content: prompt.user }],
      stream
    }

    if (
      this.config.provider === 'openai' &&
      this.config.reasoningEffort !== 'none'
    ) {
      body.reasoning = { effort: this.config.reasoningEffort || 'medium' }
    }

    return this.applyTemperature(body, options)
  }

  private buildChatCompletionsBody(
    prompt: AssembledPrompt,
    options?: GenerateOptions,
    stream = false
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      max_tokens: this.getMaxTokens(options)
    }

    if (stream) body.stream = true

    return this.applyTemperature(body, options)
  }

  private extractChatText(data: unknown): string {
    const message = (
      data as {
        choices?: Array<{
          message?: { content?: string | Array<{ text?: string }> }
        }>
      }
    ).choices?.[0]?.message?.content

    if (typeof message === 'string') return message
    if (Array.isArray(message)) {
      return message.map((part) => part?.text || '').join('')
    }
    return ''
  }

  private extractResponsesText(data: unknown): string {
    const output =
      (
        data as {
          output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
        }
      ).output || []

    return output
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text || '')
      .join('')
  }

  private getSSEChunk(event: string, data: unknown): string | null {
    if (this.wireApi === 'responses') {
      const responseEvent = data as {
        type?: string
        delta?: string
        text?: string
        response?: unknown
      }

      if (responseEvent.type === 'response.output_text.delta') {
        return responseEvent.delta || ''
      }
      if (responseEvent.type === 'response.completed') {
        return this.extractResponsesText(responseEvent.response)
      }
      return null
    }

    const chatEvent = data as {
      choices?: Array<{
        delta?: { content?: string | Array<{ text?: string }> }
        message?: { content?: string | Array<{ text?: string }> }
      }>
    }
    const content =
      chatEvent.choices?.[0]?.delta?.content ||
      chatEvent.choices?.[0]?.message?.content

    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.map((part) => part?.text || '').join('')
    }

    if (event.includes('completed')) return this.extractChatText(data)
    return null
  }

  private parseSSEText(text: string): string {
    const chunks: string[] = []
    const events = text.split(/\r?\n\r?\n/)

    for (const rawEvent of events) {
      const lines = rawEvent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length === 0) continue

      const event =
        lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim() || 'message'
      const dataLine = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')

      if (!dataLine || dataLine === '[DONE]') continue

      try {
        const parsed = JSON.parse(dataLine) as unknown
        const chunk = this.getSSEChunk(event, parsed)
        if (chunk) chunks.push(chunk)
      } catch {
        // 忽略代理混入的非 JSON SSE 数据块。
      }
    }

    return chunks.join('')
  }

  private async readGenerateText(response: Response): Promise<string> {
    const rawText = await response.text()
    const trimmed = rawText.trimStart()

    if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
      return this.parseSSEText(rawText)
    }

    try {
      const data = JSON.parse(rawText) as unknown
      return this.wireApi === 'responses'
        ? this.extractResponsesText(data)
        : this.extractChatText(data)
    } catch {
      const sseText = this.parseSSEText(rawText)
      if (sseText) return sseText
      throw new Error(`无法解析模型响应: ${rawText.slice(0, 200)}`)
    }
  }

  private async *streamSSE(
    response: Response,
    onEvent: (event: string, data: unknown) => string | null
  ): AsyncGenerator<string, void, unknown> {
    if (!response.ok) {
      const detail = await this.readResponseDetail(response)
      throw new Error(`HTTP ${response.status}: ${detail}`)
    }
    if (!response.body) throw new Error('响应体为空，无法流式读取')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

      let separatorIndex = buffer.indexOf('\n\n')
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)

        const lines = rawEvent
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        const event =
          lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim() || 'message'
        const dataLine = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')

        if (dataLine && dataLine !== '[DONE]') {
          try {
            const parsed = JSON.parse(dataLine) as unknown
            const chunk = onEvent(event, parsed)
            if (chunk) yield chunk
          } catch {
            // 忽略代理混入的非 JSON SSE 数据块。
          }
        }

        separatorIndex = buffer.indexOf('\n\n')
      }

      if (done) break
    }
  }

  private async testModelAvailability(): Promise<{
    success: boolean
    message?: string
  }> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: this.getAuthHeaders()
      })

      if (response.status === 401 || response.status === 403) {
        const detail = await this.readResponseDetail(response)
        return {
          success: false,
          message: `连接失败: API Key / 代理鉴权失败 (${response.status})${detail ? ` - ${detail}` : ''}`
        }
      }

      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id: string }> }
        const availableModels = (data.data || [])
          .map((item) => item.id)
          .filter(Boolean)

        if (
          availableModels.length > 0 &&
          !availableModels.includes(this.config.model)
        ) {
          const suggestions = availableModels.slice(0, 8).join(', ')
          return {
            success: false,
            message: `连接失败: 鉴权成功，但模型「${this.config.model}」不在可用列表中。可用模型示例: ${suggestions}`
          }
        }
      }
    } catch {
      // 某些兼容端点不支持 /models，忽略后继续走真实调用测试
    }

    return { success: true }
  }

  private async testImageGeneration(): Promise<{
    success: boolean
    message: string
    model?: string
  }> {
    const response = await this.request('/images/generations', {
      model: this.config.model || 'gpt-image-2',
      prompt: OpenAIProvider.IMAGE_TEST_PROMPT,
      size: this.config.imageSize || '1024x1024',
      quality: this.config.imageQuality || 'auto',
      output_format: this.config.imageOutputFormat || 'png',
      background: this.config.imageBackground || 'auto'
    })

    if (!response.ok) {
      const detail = await this.readResponseDetail(response)
      return {
        success: false,
        message: `连接失败: 图片生成接口不可用 (${response.status})${detail ? ` - ${detail}` : ''}`
      }
    }

    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>
    }
    const image = data.data?.[0]

    if (!image?.b64_json && !image?.url) {
      return {
        success: false,
        message: '连接失败: 图片生成接口返回成功，但响应中没有图片结果'
      }
    }

    const revisedPrompt = image.revised_prompt
      ? `，revised_prompt: ${image.revised_prompt.slice(0, 80)}`
      : ''
    return {
      success: true,
      message: `连接成功 (images/generations)，模型可生成图片，默认参数: ${this.config.imageSize || '1024x1024'} / ${this.config.imageQuality || 'auto'} / ${this.config.imageOutputFormat || 'png'} / ${this.config.imageBackground || 'auto'}${revisedPrompt}`,
      model: this.config.model
    }
  }

  async generate(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): Promise<string> {
    const response =
      this.wireApi === 'responses'
        ? await this.requestWithUnsupportedParameterRetry(
            '/responses',
            this.buildResponsesBody(prompt, options, false)
          )
        : await this.requestWithUnsupportedParameterRetry(
            '/chat/completions',
            this.buildChatCompletionsBody(prompt, options, false)
          )

    const text = await this.readGenerateText(response)

    options?.onChunk?.(text)
    return text
  }

  async *generateStream(
    prompt: AssembledPrompt,
    options?: GenerateOptions
  ): AsyncGenerator<string, void, unknown> {
    const response =
      this.wireApi === 'responses'
        ? await this.requestWithUnsupportedParameterRetry(
            '/responses',
            this.buildResponsesBody(prompt, options, true)
          )
        : await this.requestWithUnsupportedParameterRetry(
            '/chat/completions',
            this.buildChatCompletionsBody(prompt, options, true)
          )

    for await (const text of this.streamSSE(response, (event, data) =>
      this.getSSEChunk(event, data)
    )) {
      options?.onChunk?.(text)
      yield text
    }
  }

  async testConnection(): Promise<{
    success: boolean
    message: string
    model?: string
  }> {
    try {
      const modelCheck = await this.testModelAvailability()
      if (!modelCheck.success) {
        return { success: false, message: modelCheck.message || '模型不可用' }
      }

      if (this.config.category === 'image') {
        return await this.testImageGeneration()
      }

      const prompt: AssembledPrompt = {
        system: 'Reply with OK',
        user: 'Reply with OK'
      }
      const text = await this.generate(prompt)

      return {
        success: true,
        message: `连接成功 (${this.wireApi})，模型响应: ${text.substring(0, 50)}`,
        model: this.config.model
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: `连接失败: ${msg}` }
    }
  }
}
