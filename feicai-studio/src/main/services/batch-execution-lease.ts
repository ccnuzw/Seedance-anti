import { randomUUID } from 'crypto'
import type { ExecutionStatus } from '@shared/ipc-contracts'

export class ExecutionLease {
  readonly runId = randomUUID()
  readonly controller = new AbortController()
  private paused = false
  private gate: Promise<void> | null = null
  private openGate: (() => void) | null = null
  private settled: Promise<void>
  private resolveSettled!: () => void

  constructor(readonly owner: string) {
    const deferred = Promise.withResolvers<void>()
    this.settled = deferred.promise
    this.resolveSettled = deferred.resolve
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }
  get isPaused(): boolean {
    return this.paused
  }
  pause(): void {
    if (this.paused || this.signal.aborted) return
    this.paused = true
    const deferred = Promise.withResolvers<void>()
    this.gate = deferred.promise
    this.openGate = deferred.resolve
  }
  resume(): void {
    this.paused = false
    this.openGate?.()
    this.openGate = null
    this.gate = null
  }
  abort(): void {
    this.controller.abort()
    this.resume()
  }
  async checkpoint(): Promise<void> {
    this.signal.throwIfAborted()
    if (this.gate) await this.gate
    this.signal.throwIfAborted()
  }
  wait(): Promise<void> {
    return this.settled
  }
  finish(): void {
    this.resume()
    this.resolveSettled()
  }
}

let active: ExecutionLease | null = null
let closing = false

/** Synchronous acquisition must precede configuration or any asynchronous work. */
export function acquireExecutionLease(
  owner: string,
  existing?: ExecutionLease
): ExecutionLease {
  if (existing) {
    if (active !== existing || existing.signal.aborted)
      throw new Error('执行租约已失效')
    return existing
  }
  if (closing) throw new Error('应用正在关闭，不能启动新任务')
  if (active)
    throw new Error(
      '制作任务正在执行、暂停或停止中，或正在备份、恢复、修改项目数据；请等待当前操作结束后重试'
    )
  active = new ExecutionLease(owner)
  return active
}
export function releaseExecutionLease(lease: ExecutionLease): void {
  if (active === lease) active = null
  lease.finish()
}
/** Acquire before invoking any user work, and retain ownership until it settles.
 * Use at external mutation boundaries, not inside workflows that already own a lease.
 */
export async function withExecutionLease<T>(
  owner: string,
  action: () => T | Promise<T>
): Promise<T> {
  const lease = acquireExecutionLease(owner)
  try {
    return await action()
  } finally {
    releaseExecutionLease(lease)
  }
}

export function getExecutionLease(): ExecutionLease | null {
  return active
}

export function getExecutionStatus(): ExecutionStatus {
  if (!active) return { busy: false, phase: 'idle' }
  const owner =
    active.owner === 'batch' ||
    active.owner === 'pipeline' ||
    active.owner === 'workflow'
      ? active.owner
      : active.owner.includes('project') ||
          active.owner.includes('data') ||
          active.owner.includes('backup') ||
          active.owner.includes('restore')
        ? 'data'
        : 'other'
  return {
    busy: true,
    phase: active.signal.aborted
      ? 'stopping'
      : active.isPaused
        ? 'paused'
        : 'running',
    owner
  }
}
export async function stopExecution(): Promise<void> {
  const lease = active
  if (!lease) return
  lease.abort()
  await lease.wait()
}
export async function shutdownExecution(): Promise<void> {
  closing = true
  await stopExecution()
}
