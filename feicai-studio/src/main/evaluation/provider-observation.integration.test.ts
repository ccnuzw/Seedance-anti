import { afterEach, describe, expect, it, vi } from 'vitest'
import { providerContractFixture } from '@shared/provider-capabilities.fixtures'
import type { LLMConfig } from '@shared/types'
import { createTextCapabilityProvider } from '../llm/provider-factory'
import {
  capabilityConnectionReference,
  TextProviderCallError
} from '../llm/text-capability-adapter'
import {
  createObservationRecorder,
  observationFromProviderError,
  observationFromProviderResult,
  observationIdentityFromRequest
} from './observations'
import { summarizeObservations } from './summary'
import type { GenerationObservation } from '@shared/generation-observation'

function fixture(
  provider: 'openai-compatible' | 'anthropic' | 'google' = 'openai-compatible'
) {
  const config: LLMConfig = {
    id: 'test',
    name: 'offline-test',
    category: 'llm',
    provider,
    model: 'test-model',
    baseUrl: 'https://fixture.invalid/custom',
    apiKey: 'synthetic-secret',
    maxTokens: 123,
    temperature: 0.2,
    isDefault: false
  }
  const f = providerContractFixture()
  f.model.provider = provider
  f.binding.connection = capabilityConnectionReference(config)
  f.model.evidence[0].connection = structuredClone(f.binding.connection)
  f.request.prompt = {
    system: 'private system prompt',
    user: 'private user novel'
  }
  return {
    ...f,
    adapter: createTextCapabilityProvider(config, f.model, f.binding),
    context: {
      identity: observationIdentityFromRequest(
        f.request.envelope,
        f.model,
        null
      ),
      attemptId: f.request.envelope.attemptId,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z'
    }
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('actual provider adapter → observation → explicit sink → summary (mock transport, no network)', () => {
  it.each(['openai-compatible', 'anthropic', 'google'] as const)(
    'projects %s supplier metadata without deriving missing counts or bills',
    async (provider) => {
      const payload =
        provider === 'anthropic'
          ? {
              content: [{ type: 'text', text: 'private generated text' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 3, output_tokens: 1 }
            }
          : provider === 'google'
            ? {
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: { parts: [{ text: 'private generated text' }] }
                  }
                ],
                usageMetadata: {
                  promptTokenCount: 3,
                  candidatesTokenCount: 1,
                  totalTokenCount: 4
                }
              }
            : {
                choices: [
                  {
                    message: { content: 'private generated text' },
                    finish_reason: 'stop'
                  }
                ],
                usage: {
                  prompt_tokens: 3,
                  completion_tokens: 1,
                  total_tokens: 4
                }
              }
      const fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            headers: { 'content-type': 'application/json' }
          })
      )
      vi.stubGlobal('fetch', fetch)
      const f = fixture(provider),
        records: GenerationObservation[] = []
      const recorder = createObservationRecorder({
        append: async (record) => {
          records.push(record)
        }
      })
      const result = await f.adapter.generate(f.request)
      await recorder.record(
        observationFromProviderResult(f.context, result, [
          { objectId: 'episode', version: 'v2' }
        ])
      )
      const summary = summarizeObservations(records)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(summary).toMatchObject({
        generationAttempts: 1,
        statuses: { succeeded: 1 },
        usage: {
          inputTokens: { knownSubtotal: 3 },
          outputTokens: { knownSubtotal: 1 },
          totalTokens: { knownSubtotal: provider === 'anthropic' ? null : 4 }
        },
        costs: { groups: [], unknownBilled: 1, unknownEstimated: 1 }
      })
      expect(JSON.stringify({ records, summary })).not.toMatch(
        /synthetic-secret|private system|private user|private generated/
      )
    }
  )
  it.each(['length', null] as const)(
    'preserves provider finish=%s and keeps content unavailable for adoption',
    async (finishReason) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: { content: 'private partial' },
                    finish_reason: finishReason
                  }
                ]
              }),
              { headers: { 'content-type': 'application/json' } }
            )
        )
      )
      const f = fixture(),
        result = await f.adapter.generate(f.request)
      const record = observationFromProviderResult(f.context, result)
      expect(record).toMatchObject({
        status: finishReason ? 'failed' : 'unknown',
        completion: finishReason ? 'truncated' : 'unknown',
        usage: {}
      })
      expect(summarizeObservations([record]).adoption.rate).toBeNull()
    }
  )
  it('keeps real adapter 429 categories and drops supplier error bodies', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('private supplier error synthetic-secret', { status: 429 })
    )
    vi.stubGlobal('fetch', fetch)
    const f = fixture()
    const error = await f.adapter
      .generate(f.request)
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(TextProviderCallError)
    const record = observationFromProviderError(
      f.context,
      error as TextProviderCallError
    )
    expect(record).toMatchObject({
      status: 'failed',
      error: { category: 'rate_limit' },
      completion: 'incomplete'
    })
    expect(JSON.stringify(record)).not.toMatch(
      /private supplier|synthetic-secret/
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps cancellation local with remote outcome and billing unknown', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const f = fixture(),
      controller = new AbortController()
    controller.abort()
    f.request.signal = controller.signal
    const error = await f.adapter
      .generate(f.request)
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(TextProviderCallError)
    const record = observationFromProviderError(
      f.context,
      error as TextProviderCallError
    )
    expect(record).toMatchObject({
      status: 'cancelled',
      cancellation: { local: 'aborted', remote: 'unknown' },
      usage: {}
    })
    expect(summarizeObservations([record]).costs.unknownBilled).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
