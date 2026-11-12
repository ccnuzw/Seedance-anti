import type {
  ProviderCapability,
  ProviderErrorCategory,
  ProviderUsage,
  TextGenerationResult
} from './provider-capabilities'
import {
  parseProviderResult,
  PROVIDER_CAPABILITIES
} from './provider-capabilities'
import {
  parseSkillContentHash,
  type SkillPackageReference
} from './skill-package'
import {
  array,
  decode,
  id,
  instant,
  invalid,
  nullable,
  oneOf,
  reference,
  shape
} from './generation-observation/schema'

export const OBSERVATION_SCHEMA_VERSION = 1 as const
export interface ObjectVersionReference {
  objectId: string
  version: string
}
export interface ObservationIdentity {
  projectId: string
  taskId: string
  runId: string
  operationId: string
  target: ObjectVersionReference
  capability: ProviderCapability
  provider: {
    name: string
    connectionId: string
    endpointRevision: string
    descriptorId: string
    descriptorRevision: string
    modelId: string
  }
  /** Null means no resolved Skill identity was supplied, never an inferred version. */
  skill: SkillPackageReference | null
}
export interface GenerationObservation {
  schemaVersion: 1
  identity: ObservationIdentity
  attemptId: string
  kind: 'generation' | 'transport'
  /** Transport retries belong to a generation attempt and do not generate/adopt again. */
  generationAttemptId: string | null
  transportAction: 'submit' | 'poll' | 'download' | null
  startedAt: string
  endedAt: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'unknown' | 'submitted'
  completion: TextGenerationResult['completion'] | null
  error: { category: ProviderErrorCategory } | null
  cancellation: { local: 'aborted'; remote: 'confirmed' | 'unknown' } | null
  jobId: string | null
  outputs: ObjectVersionReference[]
  /** Only the generation record owns reported generation usage, including partial usage. */
  usage: ProviderUsage
}
const identitySchema = shape({
  projectId: id,
  taskId: id,
  runId: id,
  operationId: id,
  target: reference,
  capability: oneOf(PROVIDER_CAPABILITIES),
  provider: shape({
    name: id,
    connectionId: id,
    endpointRevision: id,
    descriptorId: id,
    descriptorRevision: id,
    modelId: id
  }),
  skill: nullable(
    shape({
      skillId: id,
      version: id,
      contentHash: (value) => {
        try {
          parseSkillContentHash(value)
        } catch {
          invalid()
        }
      }
    })
  )
})
const errorCategory = oneOf([
  'configuration',
  'authentication',
  'quota',
  'rate_limit',
  'network',
  'service',
  'content_refusal',
  'invalid_output',
  'download',
  'result_unknown',
  'cancelled',
  'timeout'
] satisfies ProviderErrorCategory[])
export function parseGenerationObservation(
  value: unknown
): GenerationObservation {
  const record = decode<GenerationObservation>(
    value,
    shape({
      schemaVersion: oneOf([OBSERVATION_SCHEMA_VERSION]),
      identity: identitySchema,
      attemptId: id,
      kind: oneOf(['generation', 'transport']),
      generationAttemptId: nullable(id),
      transportAction: nullable(oneOf(['submit', 'poll', 'download'])),
      startedAt: instant,
      endedAt: instant,
      status: oneOf([
        'succeeded',
        'failed',
        'cancelled',
        'unknown',
        'submitted'
      ]),
      completion: nullable(
        oneOf(['complete', 'truncated', 'refused', 'incomplete', 'unknown'])
      ),
      error: nullable(shape({ category: errorCategory })),
      cancellation: nullable(
        shape({
          local: oneOf(['aborted']),
          remote: oneOf(['confirmed', 'unknown'])
        })
      ),
      jobId: nullable(id),
      outputs: array(reference),
      usage: (usage) => {
        try {
          const result = parseProviderResult({
            kind: 'media',
            media: [],
            usage
          })
          if (result.kind !== 'media') invalid()
          for (const cost of [
            result.usage.billedCost,
            result.usage.estimatedCost
          ]) {
            if (cost && !/^[A-Z][A-Z0-9]{2,11}$/.test(cost.currency)) invalid()
          }
          if (result.usage.estimatedCost)
            id(result.usage.estimatedCost.priceVersion)
        } catch {
          invalid()
        }
      }
    })
  )
  if (record.endedAt < record.startedAt) invalid()
  if (record.kind === 'transport') {
    if (
      !record.generationAttemptId ||
      record.generationAttemptId === record.attemptId ||
      !record.transportAction ||
      Object.keys(record.usage).length ||
      record.outputs.length ||
      record.completion !== null ||
      record.status === 'submitted'
    )
      invalid()
  } else if (
    record.generationAttemptId !== null ||
    record.transportAction !== null
  )
    invalid()
  const isText = ['text.generate', 'vision.analyze'].includes(
    record.identity.capability
  )
  if (record.kind === 'generation') {
    if (record.completion !== null && !isText) invalid()
    if (
      record.status === 'succeeded' &&
      isText &&
      record.completion !== 'complete'
    )
      invalid()
  }
  if (
    record.status === 'succeeded' &&
    (record.error ||
      record.cancellation ||
      (record.completion !== null && record.completion !== 'complete'))
  )
    invalid()
  if (
    record.status === 'submitted' &&
    (!record.jobId ||
      record.completion !== null ||
      record.outputs.length ||
      record.error)
  )
    invalid()
  if (
    record.status === 'cancelled' &&
    (!record.cancellation || record.error?.category !== 'cancelled')
  )
    invalid()
  if (
    record.cancellation &&
    record.status !== 'cancelled' &&
    record.status !== 'unknown'
  )
    invalid()
  if (record.error?.category === 'cancelled' && record.status !== 'cancelled')
    invalid()
  if (record.completion === 'complete' && record.status !== 'succeeded')
    invalid()
  if (record.outputs.length && record.status !== 'succeeded') invalid()
  if (
    new Set(
      record.outputs.map((ref) => JSON.stringify([ref.objectId, ref.version]))
    ).size !== record.outputs.length
  )
    invalid()
  return record
}

/** Optional parser for separately measured adoption; never inferred from completion. */
export interface AdoptionMeasurement {
  schemaVersion: 1
  projectId: string
  output: ObjectVersionReference
  decision: 'adopted' | 'rejected' | 'unknown'
}
export function parseAdoptionMeasurement(value: unknown): AdoptionMeasurement {
  return decode(
    value,
    shape({
      schemaVersion: oneOf([1]),
      projectId: id,
      output: reference,
      decision: oneOf(['adopted', 'rejected', 'unknown'])
    })
  )
}

/** Deliberate allowlist; messages, stacks, request/response bodies are not accepted. */
export function parseObservationIdentity(value: unknown): ObservationIdentity {
  return decode(value, identitySchema)
}
