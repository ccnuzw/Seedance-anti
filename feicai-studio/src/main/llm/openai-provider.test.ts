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

    const provider = new OpenAIProvider(createConfig({ wireApi: 'responses' }))
    const text = await provider.generate({ system: 'system', user: 'user' })

    expect(text).toBe('OK')
  })

  it('随机分包的 UTF-8/CRLF SSE 在 EOF 派发末包，delta 和 completed 不重复', async () => {
    const finalText = '你好 OK'
    const events = [
      ': keepalive',
      '',
      'event: response.output_text.delta',
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: finalText })}`,
      '',
      'event: response.output_text.done',
      `data: ${JSON.stringify({ type: 'response.output_text.done', text: finalText })}`,
      '',
      'event: response.completed',
      `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: finalText }] }] } })}`
    ].join('\r\n')
    const bytes = new TextEncoder().encode(events)
    let offset = 0
    let step = 0
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset >= bytes.length) {
              controller.close()
              return
            }
            const size = [1, 7, 2, 3, 11][step++ % 5]
            controller.enqueue(bytes.slice(offset, (offset += size)))
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const onChunk = vi.fn()
    let text = ''
    for await (const piece of new OpenAIProvider(
      createConfig({ wireApi: 'responses' })
    ).generateStream({ system: 's', user: 'u' }, { onChunk }))
      text += piece
    expect(text).toBe(finalText)
    expect(onChunk).toHaveBeenCalledExactlyOnceWith(finalText)
  })

  it('completed-only 响应仍能提供最终文本', async () => {
    fetchMock.mockResolvedValue(
      createTextResponse(
        200,
        `event: response.completed\ndata: ${JSON.stringify({ response: { output: [{ content: [{ type: 'output_text', text: 'OK' }] }] } })}`
      )
    )
    expect(
      await new OpenAIProvider(createConfig({ wireApi: 'responses' })).generate(
        { system: '', user: 'u' }
      )
    ).toBe('OK')
  })

  it('completed 只补齐未发送的后缀', async () => {
    fetchMock.mockResolvedValue(
      createTextResponse(
        200,
        [
          'data: {"type":"response.output_text.delta","delta":"O"}',
          '',
          'data: {"type":"response.completed","response":{"output_text":"OK"}}'
        ].join('\n')
      )
    )
    expect(
      await new OpenAIProvider(createConfig({ wireApi: 'responses' })).generate(
        { system: '', user: 'u' }
      )
    ).toBe('OK')
  })

  it('流中 error 和 incomplete 不会被解析器吞掉或当成成功', async () => {
    for (const type of ['error', 'response.failed', 'response.incomplete']) {
      fetchMock.mockResolvedValue(
        createTextResponse(
          200,
          `data: ${JSON.stringify({ type, error: { message: 'test-key request-secret' } })}\n\n`
        )
      )
      await expect(
        new OpenAIProvider(createConfig({ wireApi: 'responses' })).generate({
          system: '',
          user: 'request-secret'
        })
      ).rejects.toThrow('模型流返回错误')
    }
  })

  it('unsupported-parameter 最多重试一次且共用真实取消 signal', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        createJsonResponse(400, {
          detail: 'Unsupported parameter: temperature test-key request-secret'
        })
      )
    )
    await expect(
      new OpenAIProvider(createConfig()).generate(
        { system: '', user: 'request-secret' },
        { temperature: 0.2 }
      )
    ).rejects.toThrow('HTTP 400')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].signal).toBe(
      fetchMock.mock.calls[1][1].signal
    )
  })

  it('非流式响应的失败状态即使带部分文本也不能成功', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        status: 'incomplete',
        output_text: 'partial output'
      })
    )
    await expect(
      new OpenAIProvider(createConfig({ wireApi: 'responses' })).generate({
        system: '',
        user: 'u'
      })
    ).rejects.toThrow('未完成')
  })

  it('图片测试使用真实图片端点且不回显 revised_prompt', async () => {
    fetchMock.mockResolvedValue(
      createJsonResponse(200, {
        data: [
          { b64_json: 'image-bytes', revised_prompt: 'test-key private-prompt' }
        ]
      })
    )
    const result = await new OpenAIProvider(
      createConfig({ category: 'image' })
    ).testConnection()
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://aigo.526566.xyz/v1/images/generations'
    )
    expect(result.success).toBe(true)
    expect(result.message).not.toMatch(/test-key|private-prompt/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
