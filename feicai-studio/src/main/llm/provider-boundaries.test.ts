import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig, LLMProviderType } from '@shared/types'
import { OpenAIProvider } from './openai-provider'
import { AnthropicProvider } from './anthropic-provider'
import { GeminiProvider } from './gemini-provider'
import { createProvider } from './provider-factory'

const fetchMock = vi.fn()
const prompt = { system: 'private-system', user: 'private-request-body' }
const encoder = new TextEncoder()

function config(
  provider: LLMProviderType,
  overrides: Partial<LLMConfig> = {}
): LLMConfig {
  return {
    id: 'test',
    name: 'test',
    category: 'llm',
    provider,
    baseUrl: 'https://models.example/custom',
    apiKey: 'private-api-key',
    model: 'example-model',
    maxTokens: 123,
    temperature: 0.2,
    isDefault: false,
    ...overrides
  }
}

function chunk(provider: LLMProviderType, text = 'A'): string {
  const data =
    provider === 'anthropic'
      ? { type: 'content_block_delta', delta: { type: 'text_delta', text } }
      : provider === 'google'
        ? { candidates: [{ content: { parts: [{ text }] } }] }
        : { choices: [{ delta: { content: text } }] }
  return `data: ${JSON.stringify(data)}\r\n\r\n`
}

function hangingBody(first?: string) {
  const cancel = vi.fn()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      if (first) value.enqueue(encoder.encode(first))
    },
    cancel
  })
  return {
    body,
    cancel,
    enqueue: (text: string) => controller.enqueue(encoder.encode(text))
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe.each(['openai-compatible', 'anthropic', 'google'] as const)(
  '%s cancellation and privacy',
  (provider) => {
    it('does not send a request when already aborted', async () => {
      const controller = new AbortController()
      controller.abort(new Error('private-api-key private-request-body'))
      await expect(
        createProvider(config(provider)).generate(prompt, {
          signal: controller.signal
        })
      ).rejects.toThrow('已取消')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('aborts a pending real fetch on the total deadline', async () => {
      vi.useFakeTimers()
      let signal!: AbortSignal
      fetchMock.mockImplementation((_url, init: RequestInit) => {
        signal = init.signal as AbortSignal
        const { promise, reject } = Promise.withResolvers<Response>()
        signal.addEventListener(
          'abort',
          () => reject(new Error('network private-api-key')),
          { once: true }
        )
        return promise
      })
      const result = createProvider(config(provider)).generate(prompt, {
        timeoutMs: 20,
        firstChunkTimeoutMs: 1000
      })
      const failure = expect(result).rejects.toThrow('总时限')
      await vi.advanceTimersByTimeAsync(21)
      await failure
      expect(signal.aborted).toBe(true)
    })

    it('cancels and releases a silent response body on the first-packet deadline', async () => {
      vi.useFakeTimers()
      const source = hangingBody()
      fetchMock.mockResolvedValue(
        new Response(source.body, {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      const failure = expect(
        createProvider(config(provider)).generate(prompt, {
          firstChunkTimeoutMs: 10,
          idleTimeoutMs: 1000,
          timeoutMs: 1000
        })
      ).rejects.toThrow('首包')
      await vi.advanceTimersByTimeAsync(11)
      await failure
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
      expect(source.cancel).toHaveBeenCalledOnce()
      expect(source.body.locked).toBe(false)
    })

    it('cancels and releases an idle stream after delivering a chunk', async () => {
      vi.useFakeTimers()
      const source = hangingBody(chunk(provider))
      fetchMock.mockResolvedValue(
        new Response(source.body, {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      const iterator = createProvider(config(provider)).generateStream(prompt, {
        idleTimeoutMs: 10,
        timeoutMs: 1000,
        firstChunkTimeoutMs: 1000
      })
      expect(await iterator.next()).toEqual({ value: 'A', done: false })
      const failure = expect(iterator.next()).rejects.toThrow('空闲')
      await vi.advanceTimersByTimeAsync(11)
      await failure
      expect(source.cancel).toHaveBeenCalledOnce()
      expect(source.body.locked).toBe(false)
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it('honors cancellation during reader.read and never echoes the abort reason', async () => {
      const source = hangingBody(chunk(provider))
      const controller = new AbortController()
      fetchMock.mockResolvedValue(
        new Response(source.body, {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      const iterator = createProvider(config(provider)).generateStream(prompt, {
        signal: controller.signal
      })
      await iterator.next()
      const failure = expect(iterator.next()).rejects.toThrow('模型请求已取消')
      controller.abort(new Error('private-api-key private-request-body'))
      await failure
      expect(source.cancel).toHaveBeenCalledOnce()
      expect(source.body.locked).toBe(false)
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it('aborts the network and releases the reader when the consumer returns early', async () => {
      const source = hangingBody(chunk(provider))
      fetchMock.mockResolvedValue(
        new Response(source.body, {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      const iterator = createProvider(config(provider)).generateStream(prompt)
      await iterator.next()
      await iterator.return(undefined)
      expect(source.cancel).toHaveBeenCalledOnce()
      expect(source.body.locked).toBe(false)
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it('does not extend the total deadline when chunks keep arriving', async () => {
      vi.useFakeTimers()
      const source = hangingBody(chunk(provider))
      fetchMock.mockResolvedValue(
        new Response(source.body, {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      const iterator = createProvider(config(provider)).generateStream(prompt, {
        timeoutMs: 20,
        idleTimeoutMs: 100,
        firstChunkTimeoutMs: 100
      })
      expect((await iterator.next()).value).toBe('A')
      await vi.advanceTimersByTimeAsync(9)
      source.enqueue(chunk(provider, 'B'))
      expect((await iterator.next()).value).toBe('B')
      const failure = expect(iterator.next()).rejects.toThrow('总时限')
      await vi.advanceTimersByTimeAsync(12)
      await failure
      expect(source.body.locked).toBe(false)
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    })

    it.each([
      new Response('private-api-key private-request-body'.repeat(1000), {
        status: 500,
        statusText: 'private-api-key'
      }),
      new Response(
        'event: error\ndata: {"error":{"message":"private-api-key private-request-body"}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      ),
      new Response('data: private-api-key private-request-body\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    ])(
      'rejects HTTP, protocol and SSE errors with bounded safe messages',
      async (response) => {
        fetchMock.mockResolvedValue(response.clone())
        const result = await createProvider(config(provider))
          .generate(prompt)
          .catch((error: Error) => error)
        expect(result).toBeInstanceOf(Error)
        const message = (result as Error).message
        expect(message).not.toMatch(/private-api-key|private-request-body/)
        expect(message.length).toBeLessThanOrEqual(240)
      }
    )

    it('rejects an empty result rather than reporting success', async () => {
      fetchMock.mockResolvedValue(
        new Response('{}', { headers: { 'content-type': 'application/json' } })
      )
      await expect(
        createProvider(config(provider)).generate(prompt)
      ).rejects.toThrow('空结果')
    })

    it('does not redirect credentials', async () => {
      fetchMock.mockRejectedValue(
        new Error('redirect private-api-key private-request-body')
      )
      await expect(
        createProvider(config(provider)).generate(prompt)
      ).rejects.not.toThrow('private-api-key')
      expect(fetchMock.mock.calls[0][1].redirect).toBe('error')
    })
  }
)

describe('native provider semantics', () => {
  it('preserves Anthropic model, system, generation limits and custom path', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }))
    )
    expect(
      await new AnthropicProvider(config('anthropic')).generate(prompt)
    ).toBe('OK')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://models.example/custom/v1/messages'
    )
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'x-api-key': 'private-api-key',
      'anthropic-version': '2023-06-01'
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'example-model',
      system: prompt.system,
      max_tokens: 123,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt.user }]
    })
  })

  it('preserves Gemini model and system semantics and keeps the key out of the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'secret-thinking', thought: true },
                  { text: 'OK' }
                ]
              }
            }
          ]
        })
      )
    )
    expect(
      await new GeminiProvider(
        config('google', { model: 'models/example-model' })
      ).generate(prompt)
    ).toBe('OK')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://models.example/custom/v1beta/models/example-model:generateContent'
    )
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'x-goog-api-key': 'private-api-key'
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { maxOutputTokens: 123, temperature: 0.2 }
    })
  })

  it('never sends a video configuration as a text generation test', async () => {
    const result = await new OpenAIProvider(
      config('openai-compatible', { category: 'video' })
    ).testConnection()
    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
