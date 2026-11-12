import {
  parseGenerationObservation,
  parseObservationIdentity,
  type GenerationObservation,
  type ObservationIdentity,
  type ObjectVersionReference
} from '@shared/generation-observation'
import { invalid } from '@shared/generation-observation/schema'
import {
  parseModelDescriptor,
  parseProviderRequestEnvelope,
  parseProviderResult,
  requireModelCapability,
  type ModelDescriptor,
  type ProviderRequestEnvelope,
  type ProviderResult
} from '@shared/provider-capabilities'
import type { SkillPackageReference } from '@shared/skill-package'
import { TextProviderCallError } from '../llm/text-capability-adapter'
import { LLMRequestError } from '../llm/endpoint-security'

export function observationIdentityFromRequest(
  requestValue: ProviderRequestEnvelope,
  modelValue: ModelDescriptor,
  skill: SkillPackageReference | null
): ObservationIdentity {
  try {
    const request = parseProviderRequestEnvelope(requestValue)
    const model = parseModelDescriptor(modelValue)
    requireModelCapability(model, request.binding)
    if ((request.skillRef ?? null) !== (skill?.skillId ?? null)) invalid()
    const { binding } = request
    return parseObservationIdentity({
      projectId: request.projectId,
      taskId: request.taskId,
      runId: request.runId,
      operationId: request.operationId,
      target: request.target,
      capability: request.capability,
      provider: {
        name: model.provider,
        ...binding.connection,
        descriptorId: model.descriptorId,
        descriptorRevision: model.revision,
        modelId: model.modelId
      },
      skill
    })
  } catch {
    return invalid()
  }
}
export interface AttemptContext {
  identity: ObservationIdentity
  attemptId: string
  startedAt: string
  endedAt: string
}
function base(context: AttemptContext): GenerationObservation {
  return {
    schemaVersion: 1,
    ...context,
    kind: 'generation',
    generationAttemptId: null,
    transportAction: null,
    status: 'unknown',
    completion: null,
    error: null,
    cancellation: null,
    jobId: null,
    outputs: [],
    usage: {}
  }
}
/** Projects existing results. Supplier prose, response text, URLs and finishReason stay out. */
export function observationFromProviderResult(
  context: AttemptContext,
  resultValue: ProviderResult,
  outputs: ObjectVersionReference[] = []
): GenerationObservation {
  let result: ProviderResult
  try {
    result = parseProviderResult(resultValue)
  } catch {
    return invalid()
  }
  const record = base(context)
  if (result.kind === 'job') {
    if (
      result.connection.connectionId !==
        context.identity.provider.connectionId ||
      result.connection.endpointRevision !==
        context.identity.provider.endpointRevision
    )
      invalid()
    record.status = 'submitted'
    record.jobId = result.jobId
  } else {
    record.usage = result.usage
    if (result.kind === 'text') {
      if (
        !['text.generate', 'vision.analyze'].includes(
          context.identity.capability
        )
      )
        invalid()
      record.completion = result.completion
      record.status =
        result.completion === 'complete'
          ? 'succeeded'
          : result.completion === 'unknown'
            ? 'unknown'
            : 'failed'
    } else {
      if (
        !['image.generate', 'video.generate'].includes(
          context.identity.capability
        ) ||
        !result.media.length
      )
        invalid()
      record.status = 'succeeded'
    }
  }
  record.outputs = outputs
  return parseGenerationObservation(record)
}
/** Uses the existing error category/partial result contract; never copies error messages. */
export function observationFromProviderError(
  context: AttemptContext,
  error: LLMRequestError
): GenerationObservation {
  if (!(error instanceof LLMRequestError)) invalid()
  const record =
    error instanceof TextProviderCallError
      ? observationFromProviderResult(context, error.partialResult)
      : base(context)
  record.status =
    error.category === 'cancelled'
      ? 'cancelled'
      : ['result_unknown', 'timeout', 'network'].includes(error.category)
        ? 'unknown'
        : 'failed'
  record.error = { category: error.category }
  if (error instanceof TextProviderCallError && error.cancellation)
    record.cancellation = error.cancellation
  if (record.status === 'cancelled' && !record.cancellation)
    record.cancellation = { local: 'aborted', remote: 'unknown' }
  // A completed payload attached to a failure is a contradictory contract, not success.
  return parseGenerationObservation(record)
}
export function operationKey(record: GenerationObservation): string {
  const i = record.identity
  return JSON.stringify([i.projectId, i.taskId, i.runId, i.operationId])
}
export function identityKey(identity: ObservationIdentity): string {
  const i = identity,
    p = i.provider
  return JSON.stringify([
    i.projectId,
    i.taskId,
    i.runId,
    i.operationId,
    i.target.objectId,
    i.target.version,
    i.capability,
    p.name,
    p.connectionId,
    p.endpointRevision,
    p.descriptorId,
    p.descriptorRevision,
    p.modelId,
    i.skill?.skillId ?? null,
    i.skill?.version ?? null,
    i.skill?.contentHash ?? null
  ])
}
/** Validate a complete observation set, optionally allowing in-flight transport parents. */
export function validateObservationSet(
  values: readonly unknown[],
  allowPendingParents = false
): GenerationObservation[] {
  const records = values.map(parseGenerationObservation)
  const attempts = new Map<string, GenerationObservation>()
  const operations = new Map<string, string>()
  for (const record of records) {
    const op = operationKey(record),
      identity = identityKey(record.identity)
    const key = JSON.stringify([op, record.attemptId])
    if (
      attempts.has(key) ||
      (operations.has(op) && operations.get(op) !== identity)
    )
      invalid()
    attempts.set(key, record)
    operations.set(op, identity)
  }
  for (const record of records) {
    if (record.kind !== 'transport') continue
    const parent = attempts.get(
      JSON.stringify([operationKey(record), record.generationAttemptId])
    )
    if (!parent && allowPendingParents) continue
    if (
      !parent ||
      parent.kind !== 'generation' ||
      identityKey(parent.identity) !== identityKey(record.identity) ||
      (record.jobId !== null && parent.jobId !== record.jobId)
    )
      invalid()
  }
  return records
}
export interface ObservationSink {
  /** Implement with the caller's persistence layer. Resolution means this append was accepted. */
  append(record: GenerationObservation): Promise<void>
}
/** Session-local validation only: no files, database, engine state or recovery authority. */
export function createObservationRecorder(sink: ObservationSink): {
  record(value: unknown): Promise<void>
} {
  const accepted: GenerationObservation[] = []
  let queue = Promise.resolve()
  return {
    record(value) {
      // Snapshot synchronously; caller mutation while queued cannot alter persisted identity.
      const snapshot = parseGenerationObservation(value)
      const pending = queue.then(async () => {
        validateObservationSet([...accepted, snapshot], true)
        await sink.append(structuredClone(snapshot))
        accepted.push(snapshot)
      })
      queue = pending.catch(() => undefined)
      return pending
    }
  }
}
