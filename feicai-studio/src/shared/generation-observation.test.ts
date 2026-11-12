import { describe, expect, it } from 'vitest'
import {
  parseGenerationObservation,
  type GenerationObservation
} from './generation-observation'

function fixture(): GenerationObservation {
  return {
    schemaVersion: 1,
    identity: {
      projectId: 'project',
      taskId: 'task',
      runId: 'run',
      operationId: 'operation',
      target: { objectId: 'episode', version: 'v1' },
      capability: 'text.generate',
      provider: {
        name: 'openai-compatible',
        connectionId: 'test',
        endpointRevision: 'fixture-endpoint',
        descriptorId: 'descriptor',
        descriptorRevision: '1',
        modelId: 'test-model'
      },
      skill: null
    },
    attemptId: 'attempt',
    kind: 'generation',
    generationAttemptId: null,
    transportAction: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    status: 'succeeded',
    completion: 'complete',
    error: null,
    cancellation: null,
    jobId: null,
    outputs: [{ objectId: 'episode', version: 'candidate-1' }],
    usage: {}
  }
}
describe('versioned observation contract', () => {
  it('snapshots data and retains unknown usage instead of introducing zero', () => {
    const input = fixture(),
      parsed = parseGenerationObservation(input)
    input.identity.provider.modelId = 'changed'
    expect(parsed.identity.provider.modelId).toBe('test-model')
    expect(parsed.usage).toEqual({})
  })
  it.each([
    [
      'future schema',
      (r: ReturnType<typeof fixture>) => ({ ...r, schemaVersion: 2 })
    ],
    [
      'request body',
      (r: ReturnType<typeof fixture>) => ({ ...r, prompt: 'private prompt' })
    ],
    [
      'nested credential',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        identity: {
          ...r.identity,
          provider: { ...r.identity.provider, apiKey: 'secret' }
        }
      })
    ],
    [
      'raw error',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        status: 'failed',
        completion: 'incomplete',
        error: { category: 'service', message: 'secret' }
      })
    ],
    [
      'negative amount',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        usage: { billedCost: { amount: -1, currency: 'USD' } }
      })
    ],
    [
      'fractional tokens',
      (r: ReturnType<typeof fixture>) => ({ ...r, usage: { inputTokens: 1.2 } })
    ],
    [
      'nonfinite cost',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        usage: { billedCost: { amount: Infinity, currency: 'USD' } }
      })
    ],
    [
      'free-form currency',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        usage: { billedCost: { amount: 1, currency: 'secret body' } }
      })
    ],
    [
      'free-form price source',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        usage: {
          estimatedCost: {
            amount: 1,
            currency: 'USD',
            priceVersion: 'secret price prose'
          }
        }
      })
    ],
    [
      'reverse time',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        endedAt: '2025-01-01T00:00:00.000Z'
      })
    ],
    [
      'truncated success',
      (r: ReturnType<typeof fixture>) => ({ ...r, completion: 'truncated' })
    ],
    [
      'unknown success',
      (r: ReturnType<typeof fixture>) => ({ ...r, completion: 'unknown' })
    ],
    [
      'missing text completion',
      (r: ReturnType<typeof fixture>) => ({ ...r, completion: null })
    ],
    [
      'text completion on media',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        identity: { ...r.identity, capability: 'image.generate' }
      })
    ],
    [
      'cancel without evidence',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        status: 'cancelled',
        completion: 'incomplete',
        outputs: []
      })
    ],
    [
      'pending without job',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        status: 'submitted',
        completion: null,
        outputs: []
      })
    ],
    [
      'transport double bills',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        kind: 'transport',
        attemptId: 'download-1',
        generationAttemptId: 'attempt',
        transportAction: 'download',
        completion: null,
        outputs: [],
        usage: { inputTokens: 1 }
      })
    ],
    [
      'bad skill hash',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        identity: {
          ...r.identity,
          skill: { skillId: 'writer', version: '1', contentHash: 'unpinned' }
        }
      })
    ],
    [
      'URL identity',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        identity: {
          ...r.identity,
          provider: {
            ...r.identity.provider,
            connectionId: 'https://user:secret@example.test'
          }
        }
      })
    ],
    [
      'duplicate output',
      (r: ReturnType<typeof fixture>) => ({
        ...r,
        outputs: [
          r.outputs[0],
          { version: r.outputs[0].version, objectId: r.outputs[0].objectId }
        ]
      })
    ]
  ])('rejects %s without echoing sensitive values', (_name, mutate) => {
    expect(() => parseGenerationObservation(mutate(fixture()))).toThrow(
      'Invalid observation/evaluation contract'
    )
    try {
      parseGenerationObservation(mutate(fixture()))
    } catch (error) {
      expect(String(error)).not.toMatch(/private prompt|secret|unpinned/)
    }
  })
})
