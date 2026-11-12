import { describe, expect, it } from 'vitest'
import {
  parseToolDescriptor,
  parseToolInvocation,
  parseToolGrant,
  parseToolAdapterResult,
  isToolJson
} from './tool-contracts'
import type { ToolDescriptor } from './tool-contracts'
const ASSET_INSPECTION_TOOL: ToolDescriptor = {
  schemaVersion: 1,
  toolId: 'fixture.inspect',
  version: '1',
  transport: 'test',
  inputSchema: { id: 'fixture-in', version: '1' },
  outputSchema: { id: 'fixture-out', version: '1' },
  effect: 'read-only',
  cost: 'free',
  scope: 'project-files',
  allowedDirectories: ['assets'],
  writeTargets: [],
  idempotency: 'supported',
  cancellation: 'cooperative',
  retry: 'never'
}

const identity = { projectId: 'p', taskId: 't', runId: 'r' }
const invocation = {
  schemaVersion: 1,
  invocationId: 'i',
  identity,
  toolId: 'tool',
  toolVersion: '1',
  grantId: 'g',
  reason: 'test',
  targets: [],
  input: {},
  timeoutMs: 100
}
const grant = {
  schemaVersion: 1,
  grantId: 'g',
  identity,
  toolId: 'tool',
  toolVersion: '1',
  allowedDirectories: ['assets'],
  allowRead: true,
  allowWrite: false,
  allowBilling: false
}

describe('tool runtime contracts', () => {
  it('accepts explicit v1 contracts and rejects unknown versions/fields', () => {
    for (const [parse, value] of [
      [parseToolDescriptor, ASSET_INSPECTION_TOOL],
      [parseToolInvocation, invocation],
      [parseToolGrant, grant],
      [parseToolAdapterResult, { schemaVersion: 1, data: {}, resources: [] }]
    ] as const) {
      expect(parse(value)).toEqual(value)
      expect(() => parse({ ...value, schemaVersion: 2 })).toThrow()
      expect(() => parse({ ...value, permissions: 'all' })).toThrow()
    }
  })
  it.each([
    'idempotency',
    'cancellation',
    'retry',
    'cost',
    'scope',
    'effect',
    'writeTargets',
    'inputSchema',
    'outputSchema'
  ])('does not default missing capability %s', (field) => {
    const value = { ...ASSET_INSPECTION_TOOL } as Record<string, unknown>
    delete value[field]
    expect(() => parseToolDescriptor(value)).toThrow()
  })
  it.each([0, -1, Infinity, 300001, 0.5])('rejects timeout %s', (timeoutMs) => {
    expect(() => parseToolInvocation({ ...invocation, timeoutMs })).toThrow()
  })
  it('rejects prototype/accessor/cyclic/non-JSON and oversized data without calling getters', () => {
    let called = false
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        called = true
        return 'secret'
      }
    })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const input of [
      accessor,
      cycle,
      new Date(),
      { a: undefined },
      { a: NaN },
      new Array(2),
      'x'.repeat(1_000_001)
    ])
      expect(isToolJson(input)).toBe(false)
    expect(called).toBe(false)
  })
  it('rejects cross-platform path escapes and malformed version references', () => {
    for (const allowedDirectories of [
      ['../other'],
      ['/tmp'],
      ['assets/link/..'],
      ['assets\\bad']
    ])
      expect(() => parseToolGrant({ ...grant, allowedDirectories })).toThrow()
    expect(() =>
      parseToolInvocation({
        ...invocation,
        targets: [
          { projectId: 'p', kind: 'made-up', objectId: 'x', revisionId: 'v' }
        ]
      })
    ).toThrow()
    expect(() => parseToolGrant({ ...grant, allowRead: undefined })).toThrow()
  })
})
