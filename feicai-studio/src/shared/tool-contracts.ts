import type { PipelineRunIdentity } from './pipeline-task'
import type { VersionRef } from './production-contracts'
import type { Schema } from './production-contracts/validation'
import {
  array,
  boolean,
  decode,
  enumeration,
  hash,
  id,
  object,
  order,
  scalar,
  nullable
} from './production-contracts/validation'
import {
  relativePathSchema,
  versionRefSchema
} from './production-contracts/schemas'

export type ToolRunIdentity = Pick<
  PipelineRunIdentity,
  'projectId' | 'taskId' | 'runId'
>
export interface ToolSchemaRef {
  id: string
  version: string
}
export interface ToolDescriptor {
  schemaVersion: 1
  toolId: string
  version: string
  transport: 'builtin' | 'test'
  inputSchema: ToolSchemaRef
  outputSchema: ToolSchemaRef
  effect: 'read-only' | 'write'
  cost: 'free' | 'metered' | 'unknown'
  scope: 'project-files'
  allowedDirectories: string[]
  writeTargets: string[]
  idempotency: 'supported' | 'unsupported' | 'unknown'
  cancellation: 'cooperative' | 'unsupported' | 'unknown'
  retry: 'never' | 'after-known-failure'
}
export interface ToolFileReference {
  projectId: string
  relativePath: string
  byteLength: number
  contentHash: string
  target: VersionRef | null
}
export type ToolReason =
  'asset-inspection' | 'workflow-step' | 'user-request' | 'test'
export interface ToolInvocation {
  schemaVersion: 1
  invocationId: string
  identity: ToolRunIdentity
  toolId: string
  toolVersion: string
  grantId: string
  reason: ToolReason
  targets: VersionRef[]
  input: unknown
  timeoutMs: number
}
/** Only trusted main-process policy code may install grants. Never accept this from model/Skill output. */
export interface ToolGrant {
  schemaVersion: 1
  grantId: string
  identity: ToolRunIdentity
  toolId: string
  toolVersion: string
  allowedDirectories: string[]
  allowRead: boolean
  allowWrite: boolean
  allowBilling: boolean
}
export interface ToolAdapterResult {
  schemaVersion: 1
  data: unknown
  resources: ToolFileReference[]
}
export interface PendingToolResource extends ToolFileReference {
  disposition: 'pending-registration'
}
export type ToolStatus =
  'succeeded' | 'rejected' | 'failed' | 'cancelled' | 'timed-out' | 'unknown'
export type ToolFailureCode =
  | 'invalid-invocation'
  | 'duplicate-invocation'
  | 'unregistered-tool'
  | 'identity-denied'
  | 'grant-denied'
  | 'invalid-input'
  | 'scope-denied'
  | 'invalid-output'
  | 'adapter-error'
  | 'cancelled'
  | 'timeout'
  | 'busy'
export interface ToolReceipt {
  schemaVersion: 1
  invocationId: string | null
  identity: ToolRunIdentity | null
  toolId: string | null
  toolVersion: string | null
  grantId: string | null
  reason: ToolReason | null
  status: ToolStatus
  code: ToolFailureCode | null
  execution: 'not-started' | 'completed' | 'unknown'
  retryAllowed: boolean
  /** Counts only; no field names, values, hashes of sensitive bodies, paths or exception text. */
  validatedInputSummary: { fieldCount: number } | null
  resourceCount: number
}
export interface ToolInvocationResult {
  schemaVersion: 1
  receipt: ToolReceipt
  data: unknown | null
  resources: PendingToolResource[]
}

const identitySchema = object<ToolRunIdentity>({
  projectId: id,
  taskId: id,
  runId: id
})
const schemaRef = object<ToolSchemaRef>({ id, version: id })
const timeout = scalar(
  (v): v is number =>
    Number.isSafeInteger(v) && typeof v === 'number' && v >= 1 && v <= 300_000,
  'Expected timeout 1..300000ms'
)
export const toolFileReferenceSchema = object<ToolFileReference>({
  projectId: id,
  relativePath: relativePathSchema,
  byteLength: order,
  contentHash: hash,
  target: nullable(versionRefSchema)
})
const jsonValue: Schema<unknown> = scalar(
  (value): value is unknown => isToolJson(value),
  'Expected bounded plain JSON data'
)
const descriptorSchema = object<ToolDescriptor>({
  schemaVersion: enumeration(1),
  toolId: id,
  version: id,
  transport: enumeration('builtin', 'test'),
  inputSchema: schemaRef,
  outputSchema: schemaRef,
  effect: enumeration('read-only', 'write'),
  cost: enumeration('free', 'metered', 'unknown'),
  scope: enumeration('project-files'),
  allowedDirectories: array(relativePathSchema),
  writeTargets: array(relativePathSchema),
  idempotency: enumeration('supported', 'unsupported', 'unknown'),
  cancellation: enumeration('cooperative', 'unsupported', 'unknown'),
  retry: enumeration('never', 'after-known-failure')
})
const invocationSchema = object<ToolInvocation>({
  schemaVersion: enumeration(1),
  invocationId: id,
  identity: identitySchema,
  toolId: id,
  toolVersion: id,
  grantId: id,
  reason: enumeration(
    'asset-inspection',
    'workflow-step',
    'user-request',
    'test'
  ),
  targets: array(versionRefSchema),
  input: jsonValue,
  timeoutMs: timeout
})
const grantSchema = object<ToolGrant>({
  schemaVersion: enumeration(1),
  grantId: id,
  identity: identitySchema,
  toolId: id,
  toolVersion: id,
  allowedDirectories: array(relativePathSchema),
  allowRead: boolean,
  allowWrite: boolean,
  allowBilling: boolean
})
const resultSchema = object<ToolAdapterResult>({
  schemaVersion: enumeration(1),
  data: jsonValue,
  resources: array(toolFileReferenceSchema)
})

/** Reject prototypes/accessors, cycles, undefined and oversized/deep payloads before reading schemas. */
export function isToolJson(input: unknown): boolean {
  const seen = new Set<object>()
  let nodes = 0
  let characters = 0
  const visit = (value: unknown, depth: number): boolean => {
    if (++nodes > 20_000 || depth > 32) return false
    if (typeof value === 'string') {
      characters += value.length
      return characters <= 1_000_000
    }
    if (value === null || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value !== 'object' || seen.has(value)) return false
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      return false
    seen.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(value).length) return false
    if (Array.isArray(value) && Object.keys(value).length !== value.length)
      return false
    for (const [key, property] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue
      characters += key.length
      if (
        !property.enumerable ||
        !('value' in property) ||
        !visit(property.value, depth + 1)
      )
        return false
    }
    seen.delete(value)
    return characters <= 1_000_000
  }
  return visit(input, 0)
}
function parse<T>(schema: Schema<T>, input: unknown): T {
  if (!isToolJson(input)) throw new Error('Invalid tool contract')
  const result = decode(schema, input)
  if (!result.ok) throw new Error('Invalid tool contract')
  return result.value
}
export const parseToolDescriptor = (input: unknown): ToolDescriptor =>
  parse(descriptorSchema, input)
export const parseToolInvocation = (input: unknown): ToolInvocation =>
  parse(invocationSchema, input)
export const parseToolGrant = (input: unknown): ToolGrant =>
  parse(grantSchema, input)
export const parseToolAdapterResult = (input: unknown): ToolAdapterResult =>
  parse(resultSchema, input)
export const parseToolFileReference = (input: unknown): ToolFileReference =>
  parse(toolFileReferenceSchema, input)

export function parseToolPayload(
  schema: Schema<unknown>,
  input: unknown
): unknown {
  return parse(schema, input)
}
