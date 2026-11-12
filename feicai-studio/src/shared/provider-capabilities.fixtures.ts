import type {
  ModelDescriptor,
  StageModelBinding,
  TextGenerationRequest
} from './provider-capabilities'

export function providerContractFixture(): {
  model: ModelDescriptor
  binding: StageModelBinding
  request: TextGenerationRequest
} {
  const model: ModelDescriptor = {
    schemaVersion: 1,
    descriptorId: 'model-descriptor',
    revision: 'revision-1',
    provider: 'openai-compatible',
    modelId: 'test-model',
    capabilities: [
      {
        capability: 'text.generate',
        support: 'supported',
        evidenceIds: ['fixture'],
        limits: { maxOutputTokens: 2000 },
        parameters: {
          maxTokens: { type: 'integer', minimum: 1, maximum: 2000 },
          temperature: { type: 'number', minimum: 0, maximum: 1 }
        },
        streaming: 'supported',
        cancellation: 'supported',
        idempotency: 'unknown',
        asynchronous: 'unsupported'
      }
    ],
    evidence: [
      {
        id: 'fixture',
        capability: 'text.generate',
        kind: 'controlled_test',
        source: 'mock-transport-fixture',
        recordedAt: '2026-01-01T00:00:00.000Z',
        connection: {
          connectionId: 'test',
          endpointRevision: 'fixture-endpoint'
        }
      }
    ]
  }
  const binding: StageModelBinding = {
    schemaVersion: 1,
    stage: 'writer',
    connection: { connectionId: 'test', endpointRevision: 'fixture-endpoint' },
    descriptorId: model.descriptorId,
    descriptorRevision: model.revision,
    modelId: model.modelId,
    capability: 'text.generate',
    parameters: {},
    fallback: 'none'
  }
  const request: TextGenerationRequest = {
    envelope: {
      schemaVersion: 1,
      projectId: 'project',
      target: { objectId: 'episode', version: 'v1' },
      taskId: 'task',
      runId: 'run',
      operationId: 'operation',
      attemptId: 'attempt',
      capability: 'text.generate',
      binding,
      inputMedia: [],
      parameters: {}
    },
    prompt: { system: 'system', user: 'user' }
  }
  return { model, binding, request }
}
