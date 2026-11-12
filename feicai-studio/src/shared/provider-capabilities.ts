/** Version 1 capability contracts. Omitted limits/features mean unknown, never unlimited. */
export const PROVIDER_CAPABILITIES = [
  'text.generate',
  'vision.analyze',
  'image.generate',
  'video.generate'
] as const
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number]
export type Support = 'supported' | 'unsupported' | 'unknown'
export type ProviderErrorCategory =
  | 'configuration'
  | 'authentication'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'service'
  | 'content_refusal'
  | 'invalid_output'
  | 'download'
  | 'result_unknown'
  | 'cancelled'
  | 'timeout'

/** Safe snapshot: credentials and endpoint URLs belong to the connection service. */
export interface ProviderConnectionReference {
  connectionId: string
  endpointRevision: string
}
export interface CapabilityEvidence {
  id: string
  capability: ProviderCapability
  kind: 'supplier_declaration' | 'controlled_test' | 'production_test'
  source: string
  recordedAt: string
  connection?: ProviderConnectionReference
}
export interface ParameterSchema {
  type: 'number' | 'integer' | 'string' | 'boolean'
  minimum?: number
  maximum?: number
  enum?: Array<string | number | boolean>
}
export interface CapabilityLimits {
  inputMimeTypes?: string[]
  maxInputCount?: number
  maxInputBytes?: number
  contextTokens?: number
  maxOutputTokens?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  minDurationSeconds?: number
  maxDurationSeconds?: number
}
export interface ModelCapability {
  capability: ProviderCapability
  support: Support
  evidenceIds: string[]
  limits: CapabilityLimits
  parameters: Record<string, ParameterSchema>
  streaming: Support
  /** Accepts local cancellation. Remote cancellation confirmation is separate. */
  cancellation: Support
  idempotency: Support
  asynchronous: Support
}
export interface ModelDescriptor {
  schemaVersion: 1
  descriptorId: string
  revision: string
  provider: string
  modelId: string
  capabilities: ModelCapability[]
  evidence: CapabilityEvidence[]
}
export interface StageModelBinding {
  schemaVersion: 1
  stage: string
  connection: ProviderConnectionReference
  descriptorId: string
  descriptorRevision: string
  modelId: string
  capability: ProviderCapability
  parameters: Record<string, string | number | boolean>
  /** No implicit fallback. A different model requires a new execution. */
  fallback: 'none'
}
export interface ProviderMediaReference {
  referenceId: string
  version: string
  mimeType: string
  bytes: number
}
export interface ProviderRequestEnvelope {
  schemaVersion: 1
  projectId: string
  target: { objectId: string; version: string }
  taskId: string
  runId: string
  operationId: string
  attemptId: string
  capability: ProviderCapability
  binding: StageModelBinding
  inputMedia: ProviderMediaReference[]
  parameters: Record<string, string | number | boolean>
  schemaRef?: string
  skillRef?: string
  timeoutMs?: number
}
/** AbortSignal is deliberately outside the serializable execution snapshot. */
export interface TextGenerationRequest {
  envelope: ProviderRequestEnvelope
  prompt: { system: string; user: string }
  signal?: AbortSignal
}
export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** Missing bill/estimate is unknown, even when token counts are known. */
  estimatedCost?: { amount: number; currency: string; priceVersion: string }
  billedCost?: { amount: number; currency: string }
}
export interface TextGenerationResult {
  kind: 'text'
  text: string
  completion: 'complete' | 'truncated' | 'refused' | 'incomplete' | 'unknown'
  finishReason?: string
  providerRequestId?: string
  providerModel?: string
  usage: ProviderUsage
}
export type TextGenerationEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'result'; result: TextGenerationResult }
/** Media references and jobs are future adapter results, not text or implemented APIs. */
export type ProviderResult =
  | TextGenerationResult
  | { kind: 'media'; media: ProviderMediaReference[]; usage: ProviderUsage }
  | { kind: 'job'; jobId: string; connection: ProviderConnectionReference }

export class ProviderContractError extends Error {
  readonly category = 'configuration' as const
  constructor(path: string) {
    super(`Invalid provider contract: ${path}`)
    this.name = 'ProviderContractError'
  }
}

type Check = (value: unknown, path: string) => void
function fail(path: string): never {
  throw new ProviderContractError(path)
}
const text: Check = (v, p) => {
  if (typeof v !== 'string' || !v.trim()) fail(p)
}
const finite: Check = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(p)
}
const positive: Check = (v, p) => {
  finite(v, p)
  if ((v as number) <= 0) fail(p)
}
const integer: Check = (v, p) => {
  positive(v, p)
  if (!Number.isSafeInteger(v)) fail(p)
}
const oneOf =
  (values: readonly unknown[]): Check =>
  (v, p) => {
    if (!values.includes(v)) fail(p)
  }
const optional =
  (check: Check): Check =>
  (v, p) => {
    if (v !== undefined) check(v, p)
  }
const array =
  (check: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) fail(p)
    ;(v as unknown[]).forEach((item, i) => check(item, `${p}[${i}]`))
  }
function record(v: unknown, p: string): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v))
  )
    fail(p)
  return v as Record<string, unknown>
}
const shape =
  (fields: Record<string, Check>): Check =>
  (v, p) => {
    const obj = record(v, p)
    for (const key of Object.keys(obj))
      if (!Object.hasOwn(fields, key)) fail(`${p}.${key}`)
    for (const [key, check] of Object.entries(fields))
      check(obj[key], `${p}.${key}`)
  }
const scalar: Check = (v, p) => {
  if (typeof v === 'number') finite(v, p)
  else if (typeof v !== 'string' && typeof v !== 'boolean') fail(p)
}
const dictionary =
  (check: Check): Check =>
  (v, p) => {
    for (const [key, value] of Object.entries(record(v, p))) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(p)
      check(value, `${p}.${key}`)
    }
  }
const capability = oneOf(PROVIDER_CAPABILITIES)
const support = oneOf(['supported', 'unsupported', 'unknown'])
const connection = shape({ connectionId: text, endpointRevision: text })
const limits = shape({
  inputMimeTypes: optional(array(text)),
  maxInputCount: optional(integer),
  maxInputBytes: optional(integer),
  contextTokens: optional(integer),
  maxOutputTokens: optional(integer),
  minWidth: optional(integer),
  maxWidth: optional(integer),
  minHeight: optional(integer),
  maxHeight: optional(integer),
  minDurationSeconds: optional(positive),
  maxDurationSeconds: optional(positive)
})
const parameterSchema = shape({
  type: oneOf(['number', 'integer', 'string', 'boolean']),
  minimum: optional(finite),
  maximum: optional(finite),
  enum: optional(array(scalar))
})
const binding = shape({
  schemaVersion: oneOf([1]),
  stage: text,
  connection,
  descriptorId: text,
  descriptorRevision: text,
  modelId: text,
  capability,
  parameters: dictionary(scalar),
  fallback: oneOf(['none'])
})
function decode<T>(value: unknown, check: Check, path: string): T {
  check(value, path)
  return structuredClone(value) as T
}

export function parseModelDescriptor(value: unknown): ModelDescriptor {
  const model = decode<ModelDescriptor>(
    value,
    shape({
      schemaVersion: oneOf([1]),
      descriptorId: text,
      revision: text,
      provider: text,
      modelId: text,
      capabilities: array(
        shape({
          capability,
          support,
          evidenceIds: array(text),
          limits,
          parameters: dictionary(parameterSchema),
          streaming: support,
          cancellation: support,
          idempotency: support,
          asynchronous: support
        })
      ),
      evidence: array(
        shape({
          id: text,
          capability,
          kind: oneOf([
            'supplier_declaration',
            'controlled_test',
            'production_test'
          ]),
          source: text,
          recordedAt: text,
          connection: optional(connection)
        })
      )
    }),
    'model'
  )
  if (
    new Set(model.capabilities.map((c) => c.capability)).size !==
      model.capabilities.length ||
    new Set(model.evidence.map((e) => e.id)).size !== model.evidence.length
  )
    fail('model.duplicates')
  for (const evidence of model.evidence) {
    if (!Number.isFinite(Date.parse(evidence.recordedAt)))
      fail('model.evidence.recordedAt')
    if (evidence.kind !== 'supplier_declaration' && !evidence.connection)
      fail('model.evidence.connection')
  }
  for (const entry of model.capabilities) {
    if (entry.support === 'supported' && !entry.evidenceIds.length)
      fail('model.capability.evidenceIds')
    for (const id of entry.evidenceIds) {
      if (
        !model.evidence.some(
          (e) => e.id === id && e.capability === entry.capability
        )
      )
        fail('model.capability.evidenceIds')
    }
    for (const [low, high] of [
      ['minWidth', 'maxWidth'],
      ['minHeight', 'maxHeight'],
      ['minDurationSeconds', 'maxDurationSeconds']
    ] as const) {
      if (
        entry.limits[low] !== undefined &&
        entry.limits[high] !== undefined &&
        entry.limits[low]! > entry.limits[high]!
      )
        fail('model.capability.limits.range')
    }
    for (const schema of Object.values(entry.parameters)) {
      if (
        (schema.minimum !== undefined || schema.maximum !== undefined) &&
        !['number', 'integer'].includes(schema.type)
      )
        fail('model.capability.parameters.range')
      if (
        schema.minimum !== undefined &&
        schema.maximum !== undefined &&
        schema.minimum > schema.maximum
      )
        fail('model.capability.parameters.range')
      for (const item of schema.enum || [])
        validateParameter(item, schema, 'model.capability.parameters.enum')
    }
  }
  return model
}
export function parseStageModelBinding(value: unknown): StageModelBinding {
  return decode(value, binding, 'binding')
}
export function parseProviderRequestEnvelope(
  value: unknown
): ProviderRequestEnvelope {
  const request = decode<ProviderRequestEnvelope>(
    value,
    shape({
      schemaVersion: oneOf([1]),
      projectId: text,
      target: shape({ objectId: text, version: text }),
      taskId: text,
      runId: text,
      operationId: text,
      attemptId: text,
      capability,
      binding,
      inputMedia: array(
        shape({
          referenceId: text,
          version: text,
          mimeType: text,
          bytes: integer
        })
      ),
      parameters: dictionary(scalar),
      schemaRef: optional(text),
      skillRef: optional(text),
      timeoutMs: optional(integer)
    }),
    'request'
  )
  if (request.capability !== request.binding.capability)
    fail('request.capability')
  return request
}
export function parseProviderResult(value: unknown): ProviderResult {
  const nonnegative: Check = (v, p) => {
    finite(v, p)
    if ((v as number) < 0) fail(p)
  }
  const tokens: Check = (v, p) => {
    nonnegative(v, p)
    if (!Number.isSafeInteger(v)) fail(p)
  }
  const usage = shape({
    inputTokens: optional(tokens),
    outputTokens: optional(tokens),
    totalTokens: optional(tokens),
    estimatedCost: optional(
      shape({ amount: nonnegative, currency: text, priceVersion: text })
    ),
    billedCost: optional(shape({ amount: nonnegative, currency: text }))
  })
  const kind = record(value, 'result').kind
  if (kind === 'text') {
    const result = decode<TextGenerationResult>(
      value,
      shape({
        kind: oneOf(['text']),
        text: (v, p) => {
          if (typeof v !== 'string') fail(p)
        },
        completion: oneOf([
          'complete',
          'truncated',
          'refused',
          'incomplete',
          'unknown'
        ]),
        finishReason: optional(text),
        providerRequestId: optional(text),
        providerModel: optional(text),
        usage
      }),
      'result'
    )
    if (
      result.completion === 'complete' &&
      (!result.finishReason || !result.text.trim())
    )
      fail('result.completion')
    return result
  }
  if (kind === 'media')
    return decode(
      value,
      shape({
        kind: oneOf(['media']),
        media: array(
          shape({
            referenceId: text,
            version: text,
            mimeType: text,
            bytes: integer
          })
        ),
        usage
      }),
      'result'
    )
  if (kind === 'job')
    return decode(
      value,
      shape({ kind: oneOf(['job']), jobId: text, connection }),
      'result'
    )
  return fail('result.kind')
}

function validateParameter(
  value: unknown,
  schema: ParameterSchema,
  path: string
): void {
  if (
    schema.type === 'integer'
      ? !Number.isSafeInteger(value)
      : typeof value !== schema.type
  )
    fail(path)
  if (typeof value === 'number') {
    finite(value, path)
    if (
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)
    )
      fail(path)
  }
  if (schema.enum && !schema.enum.includes(value as string | number | boolean))
    fail(path)
}
/** Requirements are explicit. An absent quantitative limit cannot satisfy one. */
export function requireModelCapability(
  modelValue: ModelDescriptor,
  bindingValue: StageModelBinding,
  requirements: {
    streaming?: boolean
    cancellation?: boolean
    limits?: Partial<CapabilityLimits>
  } = {}
): ModelCapability {
  const model = parseModelDescriptor(modelValue)
  const selected = parseStageModelBinding(bindingValue)
  if (
    selected.descriptorId !== model.descriptorId ||
    selected.descriptorRevision !== model.revision ||
    selected.modelId !== model.modelId
  )
    fail('binding.model')
  const entry = model.capabilities.find(
    (c) => c.capability === selected.capability
  )
  if (!entry || entry.support !== 'supported')
    fail('binding.capability.unsupported_or_unknown')
  const applicable = entry.evidenceIds.some((id) => {
    const evidence = model.evidence.find((e) => e.id === id)!
    return (
      !evidence.connection ||
      (evidence.connection.connectionId === selected.connection.connectionId &&
        evidence.connection.endpointRevision ===
          selected.connection.endpointRevision)
    )
  })
  if (!applicable) fail('binding.evidence.connection')
  for (const feature of ['streaming', 'cancellation'] as const) {
    if (requirements[feature] && entry[feature] !== 'supported')
      fail(`binding.${feature}.unsupported_or_unknown`)
  }
  for (const [key, value] of Object.entries(requirements.limits || {})) {
    const limit = entry.limits[key as keyof CapabilityLimits]
    if (Array.isArray(value)) {
      if (!Array.isArray(limit) || value.some((item) => !limit.includes(item)))
        fail(`binding.limits.${key}`)
    } else if (typeof value === 'number') {
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        typeof limit !== 'number' ||
        (key.startsWith('min') ? value < limit : value > limit)
      )
        fail(`binding.limits.${key}.unknown_or_exceeded`)
    } else fail(`binding.limits.${key}`)
  }
  validateCapabilityParameters(entry, selected.parameters)
  return entry
}
export function validateCapabilityParameters(
  entry: ModelCapability,
  parameters: StageModelBinding['parameters']
): void {
  for (const [key, value] of Object.entries(parameters)) {
    if (!Object.hasOwn(entry.parameters, key))
      fail(`parameters.${key}.unsupported_or_unknown`)
    validateParameter(value, entry.parameters[key], `parameters.${key}`)
  }
}
