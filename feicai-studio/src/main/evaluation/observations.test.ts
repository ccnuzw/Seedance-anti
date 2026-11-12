import { describe, expect, it, vi } from 'vitest'
import { providerContractFixture } from '@shared/provider-capabilities.fixtures'
import type {
  ProviderUsage,
  TextGenerationResult
} from '@shared/provider-capabilities'
import type { GenerationObservation } from '@shared/generation-observation'
import {
  createObservationRecorder,
  observationFromProviderError,
  observationFromProviderResult,
  observationIdentityFromRequest,
  validateObservationSet
} from './observations'
import { summarizeObservations } from './summary'
import { LLMRequestError } from '../llm/endpoint-security'
import { TextProviderCallError } from '../llm/text-capability-adapter'

function context() {
  const { model, request } = providerContractFixture()
  return {
    identity: observationIdentityFromRequest(request.envelope, model, null),
    attemptId: 'g1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z'
  }
}
function generation(
  attemptId = 'g1',
  usage: ProviderUsage = {}
): GenerationObservation {
  return observationFromProviderResult(
    { ...context(), attemptId },
    {
      kind: 'text',
      text: 'private-output',
      completion: 'complete',
      finishReason: 'stop',
      usage
    },
    [{ objectId: 'episode', version: 'v2' }]
  )
}
function transport(attemptId: string, parent = 'g1'): GenerationObservation {
  return {
    ...generation(attemptId),
    kind: 'transport',
    generationAttemptId: parent,
    transportAction: 'download',
    completion: null,
    outputs: [],
    usage: {}
  }
}
describe('recording and grouping generation observations', () => {
  it('distinguishes reported zero, unknown costs and partial token counts without deriving totals', () => {
    const summary = summarizeObservations([
      generation(),
      generation('g2', {
        inputTokens: 0,
        outputTokens: 5,
        billedCost: { amount: 0, currency: 'USD' }
      })
    ])
    expect(summary.costs).toMatchObject({
      unknownBilled: 1,
      unknownEstimated: 2,
      groups: [{ kind: 'billed', knownSubtotal: 0, reported: 1 }]
    })
    expect(summary.usage.inputTokens).toEqual({
      knownSubtotal: 0,
      reported: 1,
      unknown: 1
    })
    expect(summary.usage.outputTokens.knownSubtotal).toBe(5)
    expect(summary.usage.totalTokens).toEqual({
      knownSubtotal: null,
      reported: 0,
      unknown: 2
    })
    expect(summary.adoption).toEqual({
      candidates: 1,
      adopted: 0,
      rejected: 0,
      unknown: 1,
      rate: null
    })
    expect(summary.humanReworkMinutes).toBeNull()
  })
  it('refuses a token subtotal that would silently lose integer precision', () => {
    expect(() =>
      summarizeObservations([
        generation('g1', { inputTokens: Number.MAX_SAFE_INTEGER }),
        generation('g2', { inputTokens: 1 })
      ])
    ).toThrow()
  })
  it('keeps currency, estimate, price version and provider source groups separate', () => {
    const a = generation('g1', {
      billedCost: { amount: 2, currency: 'USD' },
      estimatedCost: { amount: 8, currency: 'USD', priceVersion: 'p1' }
    })
    const b = generation('g2', {
      billedCost: { amount: 3, currency: 'CNY' },
      estimatedCost: { amount: 9, currency: 'USD', priceVersion: 'p2' }
    })
    const c = generation('g3', { billedCost: { amount: 4, currency: 'USD' } })
    c.identity.operationId = 'separate-operation'
    c.identity.provider.endpointRevision = 'different-billing-source'
    const d = generation('g4', { billedCost: { amount: 1, currency: 'USD' } })
    const groups = summarizeObservations([a, b, c, d]).costs.groups
    expect(groups).toHaveLength(5)
    expect(
      groups
        .filter((g) => g.kind === 'estimated')
        .map((g) => g.knownSubtotal)
        .sort()
    ).toEqual([8, 9])
    expect(
      groups
        .filter((g) => g.kind === 'billed')
        .map((g) => g.knownSubtotal)
        .sort()
    ).toEqual([3, 3, 4])
  })
  it('counts transport attempts separately, deduplicates output adoption across regeneration, and never infers adoption', () => {
    const records = [
      generation(),
      transport('d1'),
      {
        ...transport('d2'),
        status: 'failed' as const,
        error: { category: 'download' as const }
      },
      generation('g2')
    ]
    const summary = summarizeObservations(records, [
      {
        schemaVersion: 1,
        projectId: 'project',
        output: { objectId: 'episode', version: 'v2' },
        decision: 'adopted'
      }
    ])
    expect(summary).toMatchObject({
      generationAttempts: 2,
      transportAttempts: 2,
      adoption: { candidates: 1, adopted: 1, rate: 1 }
    })
    expect(summary.costs.unknownBilled).toBe(2)
    expect(() =>
      summarizeObservations(records, [
        {
          schemaVersion: 1,
          projectId: 'other',
          output: { objectId: 'episode', version: 'v2' },
          decision: 'adopted'
        }
      ])
    ).toThrow()
    const decision = {
      schemaVersion: 1,
      projectId: 'project',
      output: { objectId: 'episode', version: 'v2' },
      decision: 'adopted'
    }
    expect(() => summarizeObservations(records, [decision, decision])).toThrow()
  })
  it('does not mix measured and unmeasured candidate adoption into a complete rate', () => {
    const other = generation('g2')
    other.outputs[0].version = 'v3'
    expect(
      summarizeObservations(
        [generation(), other],
        [
          {
            schemaVersion: 1,
            projectId: 'project',
            output: { objectId: 'episode', version: 'v2' },
            decision: 'rejected'
          }
        ]
      ).adoption
    ).toEqual({
      candidates: 2,
      adopted: 0,
      rejected: 1,
      unknown: 1,
      rate: null
    })
  })
  it('rejects duplicate attempts, orphan transports and mismatched frozen execution identities', () => {
    expect(() => validateObservationSet([generation(), generation()])).toThrow()
    expect(() => validateObservationSet([transport('d1')])).toThrow()
    expect(() =>
      validateObservationSet([generation(), transport('d1', 'missing')])
    ).toThrow()
    for (const mutate of [
      (r: GenerationObservation) => {
        r.identity.target.version = 'other'
      },
      (r: GenerationObservation) => {
        r.identity.provider.modelId = 'other'
      },
      (r: GenerationObservation) => {
        r.identity.skill = {
          skillId: 'writer',
          version: '1',
          contentHash: `sha256:${'1'.repeat(64)}`
        }
      },
      (r: GenerationObservation) => {
        r.identity.provider.connectionId = 'other'
      }
    ]) {
      const mismatched = generation('g2')
      mutate(mismatched)
      expect(() => validateObservationSet([generation(), mismatched])).toThrow()
    }
    const otherScope = generation()
    otherScope.identity.runId = 'other-run'
    expect(validateObservationSet([generation(), otherScope])).toHaveLength(2)
  })
  it('serializes sink writes, snapshots input, rejects duplicate retries and permits retry after a rejected append', async () => {
    const persisted: GenerationObservation[] = []
    const append = vi.fn(async (record: GenerationObservation) => {
      persisted.push(record)
      record.identity.provider.modelId = 'sink-mutated'
    })
    const recorder = createObservationRecorder({ append })
    const input = generation()
    const pending = recorder.record(input)
    input.identity.provider.modelId = 'caller-mutated'
    await pending
    expect(persisted[0].identity.provider.modelId).toBe('sink-mutated')
    await expect(recorder.record(generation())).rejects.toThrow()
    const two = recorder.record(generation('g2')),
      duplicate = recorder.record(generation('g2'))
    await two
    await expect(duplicate).rejects.toThrow()
    expect(append).toHaveBeenCalledTimes(2)
    const failOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('sink rejected'))
      .mockResolvedValue(undefined)
    const retriable = createObservationRecorder({ append: failOnce })
    await expect(retriable.record(generation())).rejects.toThrow(
      'sink rejected'
    )
    await retriable.record(generation())
    expect(failOnce).toHaveBeenCalledTimes(2)
  })
  it('can accept transport before its terminal generation, but refuses a mismatched parent later', async () => {
    const sink = { append: vi.fn().mockResolvedValue(undefined) }
    const recorder = createObservationRecorder(sink)
    await recorder.record(transport('d1'))
    await recorder.record(generation())
    const badParent = generation('g2')
    badParent.identity.provider.modelId = 'other'
    await expect(recorder.record(badParent)).rejects.toThrow()
    expect(sink.append).toHaveBeenCalledTimes(2)
  })
  it.each(['truncated', 'refused', 'incomplete', 'unknown'] as const)(
    'preserves %s rather than marking success',
    (completion) => {
      const record = observationFromProviderResult(context(), {
        kind: 'text',
        text: 'partial',
        completion,
        usage: {}
      })
      expect(record.completion).toBe(completion)
      expect(record.status).toBe(
        completion === 'unknown' ? 'unknown' : 'failed'
      )
      expect(record.outputs).toEqual([])
    }
  )
  it.each([
    'rate_limit',
    'timeout',
    'cancelled',
    'result_unknown',
    'invalid_output'
  ] as const)(
    'uses existing %s errors without persisting messages',
    (category) => {
      const partial: TextGenerationResult = {
        kind: 'text',
        text: 'private partial',
        completion: 'incomplete',
        usage: { inputTokens: 7 }
      }
      const record = observationFromProviderError(
        context(),
        new TextProviderCallError(
          new LLMRequestError('secret-token request-body', category),
          partial
        )
      )
      expect(record.error?.category).toBe(category)
      expect(record.usage.inputTokens).toBe(7)
      expect(JSON.stringify(record)).not.toMatch(
        /secret-token|request-body|private partial/
      )
      if (category === 'timeout' || category === 'cancelled')
        expect(record.cancellation).toEqual({
          local: 'aborted',
          remote: 'unknown'
        })
      expect(record.status).toBe(
        category === 'cancelled'
          ? 'cancelled'
          : ['timeout', 'result_unknown'].includes(category)
            ? 'unknown'
            : 'failed'
      )
    }
  )
  it('reuses media/job contracts and enforces job connection and transport ownership', () => {
    const c = context()
    c.identity.capability = 'video.generate'
    const job = observationFromProviderResult(c, {
      kind: 'job',
      jobId: 'job-1',
      connection: { connectionId: 'test', endpointRevision: 'fixture-endpoint' }
    })
    expect(job).toMatchObject({
      status: 'submitted',
      jobId: 'job-1',
      usage: {}
    })
    const download = transport('d1')
    download.identity = structuredClone(c.identity)
    download.jobId = 'job-1'
    expect(summarizeObservations([job, download]).transportAttempts).toBe(1)
    download.jobId = 'other-job'
    expect(() => summarizeObservations([job, download])).toThrow()
    expect(() =>
      observationFromProviderResult(c, {
        kind: 'job',
        jobId: 'job-1',
        connection: {
          connectionId: 'other',
          endpointRevision: 'fixture-endpoint'
        }
      })
    ).toThrow()
    expect(
      observationFromProviderResult(c, {
        kind: 'media',
        media: [
          {
            referenceId: 'video-1',
            version: '1',
            mimeType: 'video/mp4',
            bytes: 1
          }
        ],
        usage: {}
      }).status
    ).toBe('succeeded')
  })
  it('rejects request/model/skill identity mismatches using existing provider validation', () => {
    const { request, model } = providerContractFixture()
    model.modelId = 'wrong-model'
    expect(() =>
      observationIdentityFromRequest(request.envelope, model, null)
    ).toThrow()
    const f = providerContractFixture()
    f.request.envelope.skillRef = 'writer'
    expect(() =>
      observationIdentityFromRequest(f.request.envelope, f.model, null)
    ).toThrow()
    expect(
      observationIdentityFromRequest(f.request.envelope, f.model, {
        skillId: 'writer',
        version: '1',
        contentHash: `sha256:${'a'.repeat(64)}`
      }).skill?.version
    ).toBe('1')
  })
})
