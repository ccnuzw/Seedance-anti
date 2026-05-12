import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from './openai-provider'
import type { LLMConfig } from '@shared/types'

const fetchMock = vi.fn()

function createConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    id: 'cfg-1',
    name: 'OpenAI compatible',
    category: 'llm',
    provider: 'openai-compatible',
    baseUrl: 'https://aigo.526566.xyz/v1',
    apiKey: 'test-key',
    model: 'test-model',
    wireApi: 'chat-completions',
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: false,
    ...overrides
  }
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function createTextResponse(
  status: number,
  body: string,
  contentType = 'text/event-stream'
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType }
  })
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('OpenAI 兼容 provider 默认不发送 temperature', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        choices: [{ message: { content: 'OK' } }]
      })
    )

    const provider = new OpenAIProvider(createConfig())
    const text = await provider.generate({ system: 'system', user: 'user' })

    expect(text).toBe('OK')
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(requestBody).not.toHaveProperty('temperature')
  })

  it('服务端拒绝 unsupported parameter 时会删除该参数并重试', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(400, {
          detail: 'Unsupported parameter: temperature'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          choices: [{ message: { content: 'OK' } }]
        })
      )

    const provider = new OpenAIProvider(createConfig())
    const text = await provider.generate(
      { system: 'system', user: 'user' },
      { temperature: 0.2 }
    )

    expect(text).toBe('OK')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(firstBody.temperature).toBe(0.2)
    expect(retryBody).not.toHaveProperty('temperature')
  })

  it('非流式 generate 可以解析代理返回的 chat/completions SSE', async () => {
    fetchMock.mockResolvedValue(
      createTextResponse(
        200,
        [
          'data: {"choices":[{"delta":{"content":"O"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":"K"}}]}',
          '',
          'data: [DONE]',
          ''
        ].join('\n')
      )
    )

    const provider = new OpenAIProvider(createConfig())
    const text = await provider.generate({ system: 'system', user: 'user' })

    expect(text).toBe('OK')
  })

  it('非流式 generate 可以解析代理返回的 responses SSE', async () => {
    fetchMock.mockResolvedValue(
      createTextResponse(
        200,
        [
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"O"}',
          '',
          'event: response.output_text.delta',
          'data: {"type":"response.output_text.delta","delta":"K"}',
          '',
          'event: response.completed',
          'data: {"type":"response.completed"}',
          ''
        ].join('\n')
      )
    )

    const provider = new OpenAIProvider(
      createConfig({ wireApi: 'responses' })
    )
    const text = await provider.generate({ system: 'system', user: 'user' })

    expect(text).toBe('OK')
  })
})
