import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig, LLMProviderType } from '@shared/types'
import { providerContractFixture } from '@shared/provider-capabilities.fixtures'
import type { TextGenerationRequest } from '@shared/provider-capabilities'
import {
  createProvider,
  createTextCapabilityProvider
} from './provider-factory'
import {
  capabilityConnectionReference,
  TextProviderCallError
} from './text-capability-adapter'

const fetchMock = vi.fn()
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' }
  })
const sse = (...events: unknown[]) =>
  new Response(
    events.map((data) => `data: ${JSON.stringify(data)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  )
function fixture(
  provider: LLMProviderType = 'openai-compatible',
  overrides: Partial<LLMConfig> = {}
) {
  const config: LLMConfig = {
    id: 'test',
    name: 'test',
    category: 'llm',
    provider,
    model: 'test-model',
    baseUrl: 'https://models.example/custom',
    apiKey: 'private-key',
    maxTokens: 123,
    temperature: 0.2,
    isDefault: false,
    ...overrides
  }
  const { model, binding, request } = providerContractFixture()
  model.provider = provider
  binding.connection = capabilityConnectionReference(config)
  model.evidence[0].connection = structuredClone(binding.connection)
  return {
    config,
    model,
    binding,
    request,
    create: () => createTextCapabilityProvider(config, model, binding)
  }
}
function payload(provider: LLMProviderType, truncated = false): unknown {
  if (provider === 'anthropic')
    return {
      id: 'req-1',
      model: 'actual-model',
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: truncated ? 'max_tokens' : 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1 }
    }
  if (provider === 'google')
    return {
      responseId: 'req-1',
      modelVersion: 'actual-model',
      candidates: [
        {
          finishReason: truncated ? 'MAX_TOKENS' : 'STOP',
          content: { parts: [{ text: 'OK' }] }
        }
      ],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 1,
        totalTokenCount: 4
      }
    }
  return {
    id: 'req-1',
    model: 'actual-model',
    choices: [
      {
        message: { content: 'OK' },
        finish_reason: truncated ? 'length' : 'stop'
      }
    ],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
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
  '%s actual-provider compatibility bridge',
  (provider) => {
    it('delegates to the existing provider and preserves wire parameters, callbacks and legacy return type', async () => {
      const f = fixture(provider)
      fetchMock.mockImplementation(() =>
        Promise.resolve(json(payload(provider)))
      )
      const legacyChunks: string[] = []
      const old = await createProvider(f.config).generate(f.request.prompt, {
        maxTokens: 50,
        temperature: 0.4,
        onChunk: (c) => legacyChunks.push(c)
      })
      const oldBody = fetchMock.mock.calls[0][1].body
      f.request.envelope.parameters = { maxTokens: 50, temperature: 0.4 }
      const result = await f.create().generate(f.request)
      expect(old).toBe('OK')
      expect(legacyChunks).toEqual(['OK'])
      expect(fetchMock.mock.calls[1][1].body).toBe(oldBody)
      expect(result).toMatchObject({
        kind: 'text',
        text: 'OK',
        completion: 'complete',
        providerRequestId: 'req-1',
        providerModel: 'actual-model',
        usage: { inputTokens: 3, outputTokens: 1 }
      })
      expect(result.usage.estimatedCost).toBeUndefined()
      expect(result.usage.billedCost).toBeUndefined()
    })
    it('preserves legacy text while reporting explicit truncation in the new result', async () => {
      const f = fixture(provider)
      fetchMock.mockImplementation(() =>
        Promise.resolve(json(payload(provider, true)))
      )
      expect(await createProvider(f.config).generate(f.request.prompt)).toBe(
        'OK'
      )
      expect(await f.create().generate(f.request)).toMatchObject({
        text: 'OK',
        completion: 'truncated'
      })
    })
    it('never promotes EOF without a finish reason to complete or missing usage to zero', async () => {
      const f = fixture(provider)
      const data =
        provider === 'anthropic'
          ? {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'OK' }
            }
          : provider === 'google'
            ? { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }
            : { choices: [{ delta: { content: 'OK' } }] }
      fetchMock.mockResolvedValue(sse(data))
      const events = []
      for await (const event of f.create().generateStream(f.request))
        events.push(event)
      expect(events).toEqual([
        { kind: 'delta', text: 'OK' },
        {
          kind: 'result',
          result: { kind: 'text', text: 'OK', completion: 'unknown', usage: {} }
        }
      ])
    })
    it('rejects an already cancelled input without sending or exposing the abort reason', async () => {
      const f = fixture(provider)
      const controller = new AbortController()
      controller.abort(new Error('private-key'))
      f.request.signal = controller.signal
      await expect(f.create().generate(f.request)).rejects.toMatchObject({
        category: 'cancelled',
        message: '模型请求已取消',
        cancellation: { local: 'aborted', remote: 'unknown' },
        partialResult: { completion: 'incomplete', usage: {} }
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('does not invent a completion after cancellation during the actual response reader', async () => {
      const f = fixture(provider)
      const controller = new AbortController()
      f.request.signal = controller.signal
      const cancel = vi.fn()
      const body = new ReadableStream<Uint8Array>({ cancel })
      fetchMock.mockResolvedValue(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      )
      const result = f.create().generate(f.request)
      // Wait until the fetch has begun; cancellation is then handled by RequestScope.
      await Promise.resolve()
      controller.abort('private-key')
      await expect(result).rejects.toMatchObject({
        category: 'cancelled',
        partialResult: { completion: 'incomplete' }
      })
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
      expect(body.locked).toBe(false)
    })
    it('distinguishes the total deadline from input cancellation', async () => {
      vi.useFakeTimers()
      const f = fixture(provider)
      f.request.envelope.timeoutMs = 10
      fetchMock.mockReturnValue(new Promise(() => {}))
      const failure = expect(
        f.create().generate(f.request)
      ).rejects.toMatchObject({
        category: 'timeout',
        partialResult: { completion: 'incomplete' }
      })
      await vi.advanceTimersByTimeAsync(11)
      await failure
    })
  }
)

describe.each(['openai', 'openai-compatible', 'anthropic', 'google'] as const)(
  '%s effective parameter validation',
  (provider) => {
    describe.each([false, true])('streaming=%s', (streaming) => {
      async function invoke(f: ReturnType<typeof fixture>) {
        const adapter = f.create()
        if (!streaming) return adapter.generate(f.request)
        const events = []
        for await (const event of adapter.generateStream(f.request))
          events.push(event)
        return events
      }
      function sentParameters() {
        const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
        return provider === 'google'
          ? {
              maxTokens: body.generationConfig.maxOutputTokens,
              temperature: body.generationConfig.temperature
            }
          : { maxTokens: body.max_tokens, temperature: body.temperature }
      }
      it.each([
        'exceeded output limit',
        'unknown output limit',
        'undeclared maxTokens',
        'maxTokens schema range'
      ])(
        'rejects implicit config maxTokens for %s before network access',
        async (boundary) => {
          const f = fixture(provider)
          const capability = f.model.capabilities[0]
          if (boundary === 'exceeded output limit') f.config.maxTokens = 50000
          if (boundary === 'unknown output limit')
            delete capability.limits.maxOutputTokens
          if (boundary === 'undeclared maxTokens')
            delete capability.parameters.maxTokens
          if (boundary === 'maxTokens schema range')
            capability.parameters.maxTokens.maximum = 100
          await expect(invoke(f)).rejects.toThrow(/maxOutputTokens|maxTokens/)
          expect(fetchMock).not.toHaveBeenCalled()
        }
      )
      it('rejects the implicit library maxTokens default when it exceeds the output limit', async () => {
        const f = fixture(provider, {
          maxTokens: undefined,
          temperature: undefined
        })
        await expect(invoke(f)).rejects.toThrow('maxOutputTokens')
        expect(fetchMock).not.toHaveBeenCalled()
      })
      it('also validates the implicit library maxTokens default against its parameter schema', async () => {
        const f = fixture(provider, {
          maxTokens: undefined,
          temperature: undefined
        })
        f.model.capabilities[0].limits.maxOutputTokens = 10000
        f.model.capabilities[0].parameters.maxTokens.maximum = 5000
        await expect(invoke(f)).rejects.toThrow('parameters.maxTokens')
        expect(fetchMock).not.toHaveBeenCalled()
      })
      if (provider !== 'openai-compatible') {
        it.each(['out of range', 'undeclared'])(
          'rejects implicit config temperature when %s before network access',
          async (boundary) => {
            const f = fixture(provider, { temperature: 5 })
            if (boundary === 'undeclared')
              delete f.model.capabilities[0].parameters.temperature
            await expect(invoke(f)).rejects.toThrow('parameters.temperature')
            expect(fetchMock).not.toHaveBeenCalled()
          }
        )
        it('validates the implicit library temperature default before network access', async () => {
          const f = fixture(provider, { temperature: undefined })
          f.model.capabilities[0].parameters.temperature.maximum = 0.5
          await expect(invoke(f)).rejects.toThrow('parameters.temperature')
          expect(fetchMock).not.toHaveBeenCalled()
        })
      } else {
        it('preserves omitted temperature even if the unused config value is out of range and undeclared', async () => {
          const f = fixture(provider, { temperature: 5 })
          delete f.model.capabilities[0].parameters.temperature
          fetchMock.mockResolvedValue(json(payload(provider)))
          await invoke(f)
          expect(sentParameters()).toEqual({
            maxTokens: 123,
            temperature: undefined
          })
          expect(
            JSON.parse(fetchMock.mock.calls[0][1].body)
          ).not.toHaveProperty('temperature')
        })
      }
      it.each(['binding', 'request'])(
        'uses valid %s overrides over invalid config, preserving temperature zero',
        async (source) => {
          const f = fixture(provider, { maxTokens: 50000, temperature: 5 })
          f.binding.parameters =
            source === 'binding'
              ? { maxTokens: 50, temperature: 0 }
              : { maxTokens: 75, temperature: 0.4 }
          if (source === 'request')
            f.request.envelope.parameters = { maxTokens: 50, temperature: 0 }
          fetchMock.mockResolvedValue(json(payload(provider)))
          await invoke(f)
          expect(sentParameters()).toEqual({ maxTokens: 50, temperature: 0 })
          expect(fetchMock).toHaveBeenCalledOnce()
        }
      )
      it.each(['config', 'library'])(
        'preserves the legacy wire body with valid implicit %s defaults',
        async (source) => {
          const f =
            source === 'config'
              ? fixture(provider)
              : fixture(provider, {
                  maxTokens: undefined,
                  temperature: undefined
                })
          if (source === 'library') {
            f.model.capabilities[0].limits.maxOutputTokens = 10000
            f.model.capabilities[0].parameters.maxTokens.maximum = 10000
          }
          fetchMock.mockImplementation(() =>
            Promise.resolve(json(payload(provider)))
          )
          const legacy = createProvider(f.config)
          if (streaming) {
            const chunks = []
            for await (const chunk of legacy.generateStream(f.request.prompt))
              chunks.push(chunk)
            expect(chunks).toEqual(['OK'])
          } else expect(await legacy.generate(f.request.prompt)).toBe('OK')
          const legacyBody = fetchMock.mock.calls[0][1].body
          await invoke(f)
          expect(fetchMock.mock.calls[1][1].body).toBe(legacyBody)
          expect(sentParameters()).toEqual({
            maxTokens: source === 'config' ? 123 : 8192,
            temperature:
              provider === 'openai-compatible'
                ? undefined
                : source === 'config'
                  ? 0.2
                  : 0.7
          })
        }
      )
    })
  }
)

describe('bridge capability and result boundaries', () => {
  it('validates exact model, evidence, endpoint revision and capability before network access', () => {
    const f = fixture()
    f.model.capabilities[0].support = 'unknown'
    expect(f.create).toThrow('unsupported_or_unknown')
    f.model.capabilities[0].support = 'supported'
    f.config.baseUrl = 'https://other.example'
    expect(f.create).toThrow('connection_or_model')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects media, unsupported parameters, unknown limits and streaming before transport', async () => {
    const f = fixture()
    const provider = f.create()
    f.request.envelope.inputMedia = [
      { referenceId: 'image', version: '1', mimeType: 'image/png', bytes: 10 }
    ]
    await expect(provider.generate(f.request)).rejects.toThrow('inputMedia')
    f.request.envelope.inputMedia = []
    f.request.envelope.parameters = { seed: 1 }
    await expect(provider.generate(f.request)).rejects.toThrow('unimplemented')
    f.request.envelope.parameters = { maxTokens: 3000 }
    await expect(provider.generate(f.request)).rejects.toThrow(
      'unknown_or_exceeded'
    )
    delete f.model.capabilities[0].limits.maxOutputTokens
    f.request.envelope.parameters = { maxTokens: 10 }
    await expect(f.create().generate(f.request)).rejects.toThrow(
      'unknown_or_exceeded'
    )
    f.request.envelope.parameters = {}
    f.model.capabilities[0].streaming = 'unknown'
    await expect(f.create().generateStream(f.request).next()).rejects.toThrow(
      'streaming'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('freezes config and binding snapshots against caller mutation', async () => {
    const f = fixture()
    const provider = f.create()
    f.config.model = 'changed'
    f.config.maxTokens = 50000
    f.config.temperature = 5
    f.binding.parameters = { temperature: 0.9 }
    await expect(provider.generate(f.request)).rejects.toThrow(
      'request.binding'
    )
    f.binding.parameters = {}
    fetchMock.mockResolvedValue(json(payload('openai-compatible')))
    await provider.generate(f.request)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('test-model')
  })
  it.each([
    [401, 'authentication'],
    [402, 'quota'],
    [429, 'rate_limit'],
    [503, 'service'],
    [400, 'configuration']
  ])(
    'categorizes HTTP %s without returning provider body',
    async (status, category) => {
      const f = fixture()
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'private-key' } }), {
          status: status as number
        })
      )
      await expect(f.create().generate(f.request)).rejects.toMatchObject({
        category,
        partialResult: { completion: 'incomplete', usage: {} }
      })
    }
  )
  it('returns partial Responses text and explicit truncation on the legacy incomplete rejection', async () => {
    const f = fixture('openai', { wireApi: 'responses' })
    fetchMock.mockResolvedValue(
      sse(
        { type: 'response.output_text.delta', delta: 'partial' },
        {
          type: 'response.incomplete',
          response: {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' }
          }
        }
      )
    )
    await expect(f.create().generate(f.request)).rejects.toMatchObject({
      category: 'invalid_output',
      partialResult: {
        text: 'partial',
        completion: 'truncated',
        finishReason: 'max_output_tokens'
      }
    })
  })
  it('uses Responses completion and usage without duplicating text', async () => {
    const f = fixture('openai', { wireApi: 'responses' })
    fetchMock.mockResolvedValue(
      sse(
        { type: 'response.output_text.delta', delta: 'OK' },
        {
          type: 'response.completed',
          response: {
            id: 'response-id',
            status: 'completed',
            model: 'actual',
            output_text: 'OK',
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 }
          }
        }
      )
    )
    expect(await f.create().generate(f.request)).toMatchObject({
      text: 'OK',
      completion: 'complete',
      providerRequestId: 'response-id',
      usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 }
    })
  })
  it.each([false, true])(
    'requires Anthropic message_stop and preserves truncation (truncated=%s)',
    async (truncated) => {
      const f = fixture('anthropic')
      const events = [
        {
          type: 'message_start',
          message: { id: 'id', usage: { input_tokens: 8 } }
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'OK' }
        },
        {
          type: 'message_delta',
          delta: { stop_reason: truncated ? 'max_tokens' : 'end_turn' },
          usage: { output_tokens: 2 }
        }
      ]
      fetchMock
        .mockResolvedValueOnce(sse(...events))
        .mockResolvedValueOnce(sse(...events, { type: 'message_stop' }))
      expect(await f.create().generate(f.request)).toMatchObject({
        completion: truncated ? 'truncated' : 'incomplete',
        usage: { inputTokens: 8, outputTokens: 2 }
      })
      expect(await f.create().generate(f.request)).toMatchObject({
        completion: truncated ? 'truncated' : 'complete'
      })
    }
  )
  it('does not treat an Anthropic message_stop without a stop reason as complete', async () => {
    const f = fixture('anthropic')
    fetchMock.mockResolvedValue(
      sse(
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'OK' }
        },
        { type: 'message_stop' }
      )
    )
    expect(await f.create().generate(f.request)).toMatchObject({
      completion: 'unknown'
    })
  })
  it('reports content refusal as a separate category with partial result', async () => {
    const f = fixture('google')
    fetchMock.mockResolvedValue(
      json({ candidates: [{ finishReason: 'SAFETY' }] })
    )
    await expect(f.create().generate(f.request)).rejects.toMatchObject({
      category: 'content_refusal',
      partialResult: { completion: 'refused' }
    })
  })
  it('does not mix metadata between concurrent requests on one adapter', async () => {
    const f = fixture()
    const provider = f.create()
    fetchMock
      .mockResolvedValueOnce(json(payload('openai-compatible', true)))
      .mockResolvedValueOnce(
        json({ choices: [{ message: { content: 'second' } }] })
      )
    const second: TextGenerationRequest = structuredClone(f.request)
    second.envelope.attemptId = 'attempt-2'
    const results = await Promise.all([
      provider.generate(f.request),
      provider.generate(second)
    ])
    expect(results[0].completion).toBe('truncated')
    expect(results[1]).toEqual({
      kind: 'text',
      text: 'second',
      completion: 'unknown',
      usage: {}
    })
  })
  it('releases transport on early stream consumer return without yielding a final result', async () => {
    const f = fixture()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"A"}}]}\n\n'
          )
        )
      },
      cancel
    })
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    )
    const iterator = f.create().generateStream(f.request)
    expect(await iterator.next()).toEqual({
      value: { kind: 'delta', text: 'A' },
      done: false
    })
    expect(await iterator.return()).toEqual({ value: undefined, done: true })
    expect(cancel).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
  })
  it('distinguishes fetch network failures, invalid output and configuration errors', async () => {
    const f = fixture()
    fetchMock
      .mockRejectedValueOnce(new TypeError('private-key'))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(new Response('{bad-json'))
    await expect(f.create().generate(f.request)).rejects.toMatchObject({
      category: 'network'
    })
    await expect(f.create().generate(f.request)).rejects.toMatchObject({
      category: 'invalid_output'
    })
    await expect(f.create().generate(f.request)).rejects.toMatchObject({
      category: 'invalid_output'
    })
    f.config.apiKey = ''
    try {
      f.create()
      throw new Error('expected configuration failure')
    } catch (error) {
      expect(error).toMatchObject({ category: 'configuration' })
    }
  })
  it('rejects a cancellation requirement when its capability is unknown', async () => {
    const f = fixture()
    f.model.capabilities[0].cancellation = 'unknown'
    f.request.signal = new AbortController().signal
    await expect(f.create().generate(f.request)).rejects.toThrow('cancellation')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('merges only declared parameters and preserves zero temperature', async () => {
    const f = fixture()
    f.binding.parameters = { maxTokens: 50, temperature: 0.7 }
    f.request.envelope.parameters = { temperature: 0 }
    fetchMock.mockResolvedValue(json(payload('openai-compatible')))
    await f.create().generate(f.request)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      max_tokens: 50,
      temperature: 0
    })
  })
  it('uses a safe unknown category for an unclassified failure', async () => {
    const f = fixture()
    fetchMock.mockRejectedValue(new Error('private-key'))
    const error = await f
      .create()
      .generate(f.request)
      .catch((error) => error)
    expect(error).toBeInstanceOf(TextProviderCallError)
    expect(error.category).toBe('result_unknown')
    expect(error.message).not.toContain('private-key')
  })
})
