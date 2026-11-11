import { describe, expect, it } from 'vitest'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease,
  shutdownExecution
} from './batch-execution-lease'

describe('global execution ownership', () => {
  it('rejects stale ownership and fences each independent execution with a unique runId', () => {
    const first = acquireExecutionLease('pipeline')
    expect(acquireExecutionLease('child', first)).toBe(first)
    expect(() => acquireExecutionLease('workflow')).toThrow()
    releaseExecutionLease(first)
    const second = acquireExecutionLease('workflow')
    expect(second.runId).not.toBe(first.runId)
    expect(() => acquireExecutionLease('stale-child', first)).toThrow('失效')
    releaseExecutionLease(second)
  })
  it('pause suspends the coroutine until resume without releasing ownership', async () => {
    const lease = acquireExecutionLease('batch')
    lease.pause()
    let advanced = false
    const checkpoint = lease.checkpoint().then(() => {
      advanced = true
    })
    await Promise.resolve()
    expect(advanced).toBe(false)
    expect(getExecutionLease()).toBe(lease)
    lease.resume()
    await checkpoint
    expect(advanced).toBe(true)
    releaseExecutionLease(lease)
  })
  it('shutdown waits even for non-cancellable management transactions and blocks new work', async () => {
    const lease = acquireExecutionLease('project-restore')
    let closed = false
    const shutdown = shutdownExecution().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    expect(lease.signal.aborted).toBe(true)
    expect(() => acquireExecutionLease('late')).toThrow('关闭')
    releaseExecutionLease(lease)
    await shutdown
    expect(closed).toBe(true)
  })
})
