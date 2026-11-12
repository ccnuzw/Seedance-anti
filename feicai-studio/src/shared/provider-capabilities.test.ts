import { describe, expect, it } from 'vitest'
import {
  parseModelDescriptor,
  parseProviderRequestEnvelope,
  parseProviderResult,
  parseStageModelBinding,
  requireModelCapability
} from './provider-capabilities'
import { providerContractFixture } from './provider-capabilities.fixtures'

describe('versioned provider contracts', () => {
  it('decodes independent snapshots without credentials', () => {
    const { model, binding, request } = providerContractFixture()
    const parsed = parseModelDescriptor(model)
    parsed.capabilities[0].support = 'unknown'
    expect(model.capabilities[0].support).toBe('supported')
    expect(parseStageModelBinding(binding)).toEqual(binding)
    expect(parseProviderRequestEnvelope(request.envelope)).toEqual(
      request.envelope
    )
    expect(() =>
      parseStageModelBinding({ ...binding, apiKey: 'private' })
    ).toThrow('apiKey')
    expect(() => parseModelDescriptor({ ...model, schemaVersion: 2 })).toThrow(
      'schemaVersion'
    )
    expect(() =>
      parseProviderRequestEnvelope({ ...request.envelope, schemaVersion: 2 })
    ).toThrow('schemaVersion')
  })
  it.each(['unsupported', 'unknown'] as const)(
    'rejects %s support and never infers from model name',
    (support) => {
      const { model, binding } = providerContractFixture()
      model.capabilities[0].support = support
      expect(() => requireModelCapability(model, binding)).toThrow(
        'unsupported_or_unknown'
      )
      model.capabilities = []
      expect(() => requireModelCapability(model, binding)).toThrow(
        'unsupported_or_unknown'
      )
    }
  )
  it('requires evidence for the selected capability and connection revision', () => {
    const { model, binding } = providerContractFixture()
    model.capabilities[0].evidenceIds = []
    expect(() => parseModelDescriptor(model)).toThrow('evidenceIds')
    model.capabilities[0].evidenceIds = ['fixture']
    binding.connection.endpointRevision = 'different-endpoint'
    expect(() => requireModelCapability(model, binding)).toThrow(
      'evidence.connection'
    )
    model.evidence[0].capability = 'image.generate'
    expect(() => parseModelDescriptor(model)).toThrow('evidenceIds')
  })
  it('keeps supplier declarations and scoped observed evidence separate', () => {
    const { model, binding } = providerContractFixture()
    model.evidence[0].kind = 'supplier_declaration'
    delete model.evidence[0].connection
    expect(requireModelCapability(model, binding).support).toBe('supported')
    model.evidence[0].kind = 'controlled_test'
    expect(() => parseModelDescriptor(model)).toThrow('evidence.connection')
  })
  it('rejects unknown features, limits, mismatched versions and undeclared parameters', () => {
    const { model, binding } = providerContractFixture()
    model.capabilities[0].streaming = 'unknown'
    expect(() =>
      requireModelCapability(model, binding, { streaming: true })
    ).toThrow('streaming')
    expect(() =>
      requireModelCapability(model, binding, { limits: { maxInputBytes: 12 } })
    ).toThrow('unknown_or_exceeded')
    expect(() =>
      requireModelCapability(model, binding, {
        limits: { inputMimeTypes: ['image/png'] }
      })
    ).toThrow('inputMimeTypes')
    binding.parameters = { seed: 1 }
    expect(() => requireModelCapability(model, binding)).toThrow('seed')
    binding.parameters = { maxTokens: Infinity }
    expect(() => requireModelCapability(model, binding)).toThrow()
    binding.parameters = { maxTokens: 1.5 }
    expect(() => requireModelCapability(model, binding)).toThrow('maxTokens')
    binding.parameters = {}
    binding.descriptorRevision = 'new'
    expect(() => requireModelCapability(model, binding)).toThrow(
      'binding.model'
    )
  })
  it('validates explicit media limits and rejects conflicting ranges', () => {
    const { model, binding } = providerContractFixture()
    const entry = model.capabilities[0]
    entry.capability = 'vision.analyze'
    model.evidence[0].capability = binding.capability = 'vision.analyze'
    entry.limits = {
      inputMimeTypes: ['image/png'],
      maxInputCount: 2,
      maxInputBytes: 1024,
      minWidth: 64,
      maxWidth: 1024
    }
    expect(
      requireModelCapability(model, binding, {
        limits: {
          inputMimeTypes: ['image/png'],
          maxInputBytes: 1024,
          minWidth: 64
        }
      })
    ).toMatchObject({ capability: 'vision.analyze' })
    expect(() =>
      requireModelCapability(model, binding, { limits: { maxInputCount: 3 } })
    ).toThrow('maxInputCount')
    expect(() =>
      requireModelCapability(model, binding, { limits: { minWidth: 32 } })
    ).toThrow('minWidth')
    entry.limits.minWidth = 2048
    expect(() => parseModelDescriptor(model)).toThrow('limits.range')
  })
  it('validates result variants and preserves unknown usage without zero defaults', () => {
    const unknown = {
      kind: 'text',
      text: 'partial',
      completion: 'unknown',
      usage: {}
    }
    expect(parseProviderResult(unknown)).toEqual(unknown)
    expect(() =>
      parseProviderResult({ ...unknown, completion: 'complete' })
    ).toThrow('completion')
    expect(() =>
      parseProviderResult({ ...unknown, usage: { inputTokens: -1 } })
    ).toThrow('inputTokens')
    expect(() =>
      parseProviderResult({
        ...unknown,
        usage: { estimatedCost: { amount: 1, currency: 'USD' } }
      })
    ).toThrow('priceVersion')
    expect(
      parseProviderResult({
        kind: 'job',
        jobId: 'job',
        connection: { connectionId: 'connection', endpointRevision: 'revision' }
      }).kind
    ).toBe('job')
    expect(
      parseProviderResult({
        kind: 'media',
        media: [
          {
            referenceId: 'image',
            version: 'v1',
            mimeType: 'image/png',
            bytes: 10
          }
        ],
        usage: {}
      }).kind
    ).toBe('media')
    expect(() => parseProviderResult({ kind: 'audio' })).toThrow('kind')
  })
  it('rejects duplicate capabilities, invalid dates, unknown schema fields and invalid schemas', () => {
    const { model } = providerContractFixture()
    model.capabilities.push(structuredClone(model.capabilities[0]))
    expect(() => parseModelDescriptor(model)).toThrow('duplicates')
    model.capabilities.pop()
    model.evidence[0].recordedAt = 'invalid'
    expect(() => parseModelDescriptor(model)).toThrow('recordedAt')
    model.evidence[0].recordedAt = '2026-01-01'
    model.capabilities[0].parameters.temperature.enum = ['hot']
    expect(() => parseModelDescriptor(model)).toThrow('parameters.enum')
  })
})
