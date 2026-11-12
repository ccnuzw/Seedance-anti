import { closeSync, constants, fstatSync, openSync, readSync } from 'fs'
import { createHash } from 'crypto'
import { performance } from 'perf_hooks'
import { resolve } from 'path'
import {
  parseToolAdapterResult,
  parseToolFileReference,
  parseToolGrant,
  parseToolInvocation,
  parseToolPayload
} from '../../shared/tool-contracts'
import type {
  ToolFileReference,
  ToolGrant,
  ToolInvocation,
  ToolInvocationResult,
  ToolReceipt,
  ToolFailureCode,
  ToolRunIdentity
} from '../../shared/tool-contracts'
import { isWithinRelativeDirectory } from '../../shared/production-contracts/paths'
import {
  assertPathWithinProject,
  assertProjectFileReadAllowed,
  assertRegisteredProjectRoot
} from '../security/access-control'
import type { RegisteredTool, ToolRegistry } from './tool-registry'

const sameIdentity = (a: ToolRunIdentity, b: ToolRunIdentity): boolean =>
  a.projectId === b.projectId && a.taskId === b.taskId && a.runId === b.runId
const inScope = (path: string, directories: string[]): boolean =>
  directories.some((directory) => isWithinRelativeDirectory(path, directory))
class Denied extends Error {
  constructor(readonly code: ToolFailureCode) {
    super(code)
  }
}
export interface ToolServiceOptions {
  registry: ToolRegistry
  /** Trusted active task/run lookup. Must verify membership and return the registered root, or null. */
  resolveRun(identity: ToolRunIdentity): string | null
}
/** Independent API: no IPC, persistence, task mutation, adoption, review or external connections. */
export class ToolInvocationService {
  private readonly grants = new Map<string, ToolGrant>()
  private readonly usedIds = new Set<string>()
  private readonly receipts: ToolReceipt[] = []
  private busy = false
  constructor(private readonly options: ToolServiceOptions) {}

  installGrant(input: unknown): void {
    const grant = parseToolGrant(input)
    if (this.grants.has(grant.grantId)) throw new Error('Duplicate tool grant')
    this.grants.set(grant.grantId, grant)
  }
  revokeGrant(grantId: string): void {
    this.grants.delete(grantId)
  }
  getReceipts(): ToolReceipt[] {
    return structuredClone(this.receipts)
  }

  async invoke(
    input: unknown,
    signal?: AbortSignal
  ): Promise<ToolInvocationResult> {
    const startedAt = performance.now()
    let deadline = Infinity
    const controller = new AbortController()
    const interruptedKind = (): 'cancel' | 'timeout' | undefined =>
      signal?.aborted
        ? 'cancel'
        : performance.now() >= deadline
          ? 'timeout'
          : undefined
    const checkBudget = (): void => {
      const kind = interruptedKind()
      if (kind) throw new Denied(kind === 'cancel' ? 'cancelled' : 'timeout')
    }
    const receipt: ToolReceipt = {
      schemaVersion: 1,
      invocationId: null,
      identity: null,
      toolId: null,
      toolVersion: null,
      grantId: null,
      reason: null,
      status: 'rejected',
      code: 'invalid-invocation',
      execution: 'not-started',
      retryAllowed: false,
      validatedInputSummary: null,
      resourceCount: 0
    }
    const finish = (
      data: unknown = null,
      resources: ToolInvocationResult['resources'] = []
    ): ToolInvocationResult => {
      this.receipts.push(structuredClone(receipt))
      return {
        schemaVersion: 1,
        receipt: structuredClone(receipt),
        data,
        resources
      }
    }
    const finishInterrupted = (
      kind: 'cancel' | 'timeout'
    ): ToolInvocationResult => {
      receipt.status = kind === 'timeout' ? 'timed-out' : 'cancelled'
      receipt.code = kind === 'timeout' ? 'timeout' : 'cancelled'
      controller.abort()
      return finish()
    }
    let invocation: ToolInvocation
    let tool: RegisteredTool
    let root: string
    let grant: ToolGrant
    let validated: unknown
    const checkPolicy = (): void => {
      if (this.grants.get(grant.grantId) !== grant)
        throw new Denied('grant-denied')
      const currentRoot = this.options.resolveRun(
        structuredClone(invocation.identity)
      )
      if (!currentRoot) throw new Denied('identity-denied')
      try {
        if (assertRegisteredProjectRoot(currentRoot) !== root)
          throw new Error('Root changed')
      } catch {
        throw new Denied('identity-denied')
      }
    }
    try {
      invocation = structuredClone(parseToolInvocation(input))
      deadline = startedAt + invocation.timeoutMs
      Object.assign(receipt, {
        invocationId: invocation.invocationId,
        identity: invocation.identity,
        toolId: invocation.toolId,
        toolVersion: invocation.toolVersion,
        grantId: invocation.grantId,
        reason: invocation.reason
      })
      checkBudget()
      if (this.usedIds.has(invocation.invocationId))
        throw new Denied('duplicate-invocation')
      this.usedIds.add(invocation.invocationId)
      if (this.busy) throw new Denied('busy')
      const registered = this.options.registry.get(
        invocation.toolId,
        invocation.toolVersion
      )
      if (!registered) throw new Denied('unregistered-tool')
      tool = registered
      const resolved = this.options.resolveRun(
        structuredClone(invocation.identity)
      )
      if (!resolved) throw new Denied('identity-denied')
      root = assertRegisteredProjectRoot(resolved)
      const installed = this.grants.get(invocation.grantId)
      if (
        !installed ||
        !sameIdentity(installed.identity, invocation.identity) ||
        installed.toolId !== invocation.toolId ||
        installed.toolVersion !== invocation.toolVersion ||
        !installed.allowRead
      )
        throw new Denied('grant-denied')
      grant = installed
      if (
        invocation.targets.some(
          (target) => target.projectId !== invocation.identity.projectId
        )
      )
        throw new Denied('scope-denied')
      checkBudget()
      try {
        validated = parseToolPayload(tool.input, invocation.input)
      } catch {
        throw new Denied('invalid-input')
      }
      receipt.validatedInputSummary = {
        fieldCount:
          validated && typeof validated === 'object'
            ? Object.keys(validated).length
            : 0
      }
      checkBudget()
      const references = tool.adapter.inputResources(validated)
      checkBudget()
      for (const reference of references)
        this.inspect(reference, invocation, root, tool, grant, checkBudget)
      checkBudget()
    } catch (error) {
      if (
        error instanceof Denied &&
        (error.code === 'timeout' || error.code === 'cancelled')
      )
        return finishInterrupted(
          error.code === 'timeout' ? 'timeout' : 'cancel'
        )
      receipt.code =
        error instanceof Denied
          ? error.code
          : receipt.invocationId === null
            ? 'invalid-invocation'
            : 'scope-denied'
      return finish()
    }
    // A timed-out/cancelled adapter retains the capacity until its promise actually settles.
    this.busy = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    type Outcome =
      | { kind: 'result'; value: unknown }
      | { kind: 'error'; code: ToolFailureCode }
      | { kind: 'timeout' }
      | { kind: 'cancel' }
    const interrupted = new Promise<Outcome>((resolveOutcome) => {
      onAbort = () => {
        controller.abort()
        resolveOutcome({ kind: 'cancel' })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(
        () => {
          controller.abort()
          resolveOutcome({ kind: 'timeout' })
        },
        Math.max(0, deadline - performance.now())
      )
    })
    const execution: Promise<Outcome> = Promise.resolve()
      .then(() => {
        checkBudget()
        checkPolicy()
        checkBudget()
        receipt.execution = 'unknown'
        return tool.adapter.execute(validated, {
          signal: controller.signal,
          inspectFile: (reference) => {
            checkBudget()
            checkPolicy()
            return this.inspect(
              reference,
              invocation,
              root,
              tool,
              grant,
              checkBudget
            )
          }
        })
      })
      .then(
        (value): Outcome => ({ kind: 'result', value }),
        (error): Outcome => ({
          kind: 'error',
          code: error instanceof Denied ? error.code : 'adapter-error'
        })
      )
      .finally(() => {
        this.busy = false
      })
    const outcome = await Promise.race([execution, interrupted])
    if (timer) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    const interruption =
      outcome.kind === 'timeout' || outcome.kind === 'cancel'
        ? outcome.kind
        : interruptedKind()
    if (interruption) return finishInterrupted(interruption)
    if (outcome.kind !== 'result') {
      receipt.status =
        receipt.execution === 'not-started' ? 'rejected' : 'unknown'
      receipt.code =
        outcome.kind === 'error' && receipt.execution === 'not-started'
          ? outcome.code
          : 'adapter-error'
      return finish()
    }
    try {
      checkBudget()
      checkPolicy()
      const result = parseToolAdapterResult(outcome.value)
      const data = structuredClone(parseToolPayload(tool.output, result.data))
      const resources = result.resources.map((reference) => ({
        ...this.inspect(reference, invocation, root, tool, grant, checkBudget),
        disposition: 'pending-registration' as const
      }))
      const finalInterruption = interruptedKind()
      if (finalInterruption) return finishInterrupted(finalInterruption)
      receipt.status = 'succeeded'
      receipt.code = null
      receipt.execution = 'completed'
      receipt.resourceCount = resources.length
      return finish(data, resources)
    } catch {
      const finalInterruption = interruptedKind()
      if (finalInterruption) return finishInterrupted(finalInterruption)
      receipt.status = 'failed'
      receipt.code = 'invalid-output'
      // A malformed reply cannot establish whether the operation completed.
      return finish()
    }
  }

  private inspect(
    input: unknown,
    invocation: ToolInvocation,
    root: string,
    tool: RegisteredTool,
    grant: ToolGrant,
    checkBudget: () => void
  ): ToolFileReference {
    checkBudget()
    let reference: ToolFileReference
    try {
      reference = parseToolFileReference(input)
    } catch {
      throw new Denied('scope-denied')
    }
    if (
      reference.projectId !== invocation.identity.projectId ||
      (reference.target &&
        reference.target.projectId !== invocation.identity.projectId) ||
      !inScope(reference.relativePath, tool.descriptor.allowedDirectories) ||
      !inScope(reference.relativePath, grant.allowedDirectories)
    )
      throw new Denied('scope-denied')
    const path = assertPathWithinProject(
      assertRegisteredProjectRoot(root),
      resolve(root, reference.relativePath)
    )
    assertProjectFileReadAllowed(path)
    checkBudget()
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = fstatSync(fd)
      if (
        !before.isFile() ||
        before.size > 64 * 1024 * 1024 ||
        before.size !== reference.byteLength
      )
        throw new Denied('scope-denied')
      const digest = createHash('sha256')
      const buffer = Buffer.alloc(64 * 1024)
      let count = 0
      let bytes = 0
      while (true) {
        checkBudget()
        count = readSync(fd, buffer, 0, buffer.length, null)
        checkBudget()
        if (count === 0) break
        bytes += count
        if (bytes > reference.byteLength) throw new Denied('scope-denied')
        digest.update(buffer.subarray(0, count))
      }
      const after = fstatSync(fd)
      assertPathWithinProject(root, path)
      if (
        bytes !== reference.byteLength ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        digest.digest('hex') !== reference.contentHash
      )
        throw new Denied('scope-denied')
      checkBudget()
      return reference
    } finally {
      closeSync(fd)
    }
  }
}
