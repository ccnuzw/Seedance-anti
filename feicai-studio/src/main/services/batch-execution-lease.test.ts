import { describe, expect, it } from 'vitest'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease,
  shutdownExecution,
  withExecutionLease
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
  it.each(['return', 'throw', 'reject'] as const)(
    'mutation acquisition is synchronous and releases after %s',
    async (result) => {
      const action = () => {
        expect(getExecutionLease()?.owner).toBe('mutation')
        expect(() => acquireExecutionLease('pipeline')).toThrow('请等待')
        if (result === 'throw') throw new Error('sync failure')
        if (result === 'reject')
          return Promise.reject(new Error('async failure'))
        return 42
      }
      const pending = withExecutionLease('mutation', action)
      if (result === 'return') await expect(pending).resolves.toBe(42)
      else await expect(pending).rejects.toThrow('failure')
      expect(getExecutionLease()).toBeNull()
    }
  )
  it('an unrelated mutation cannot reuse workflow ownership; legitimate children still can', async () => {
    const lease = acquireExecutionLease('workflow')
    await expect(withExecutionLease('manual-write', () => 1)).rejects.toThrow(
      '请等待'
    )
    expect(acquireExecutionLease('internal-write', lease)).toBe(lease)
    expect(getExecutionLease()).toBe(lease)
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
