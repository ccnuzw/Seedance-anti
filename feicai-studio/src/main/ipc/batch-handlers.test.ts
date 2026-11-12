import { describe, expect, it, vi } from 'vitest'
import { BATCH_IPC } from '@shared/batch'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn()
}))
vi.mock('../security/access-control', () => ({
  assertEpisodeNumber: vi.fn(),
  assertRegisteredProjectRoot: vi.fn()
}))
vi.mock('../security/safe-ipc', () => ({
  registerSafeIpcHandler: (
    channel: string,
    handler: (...args: unknown[]) => unknown
  ) => mocks.handlers.set(channel, handler)
}))
vi.mock('../services/pipeline-runtime-service', () => ({
  getBatchQueueRuntime: () => mocks
}))
import { registerBatchHandlers, validateBatchTarget } from './batch-handlers'

describe('batch directed control IPC', () => {
  it('rejects malformed targets and forwards exact queue id without fallback', () => {
    registerBatchHandlers()
    for (const invalid of [null, '', ' ', 12, {}, 'q'.repeat(257)])
      expect(() => validateBatchTarget(invalid)).toThrow('标识')
    for (const [channel, method] of [
      [BATCH_IPC.PAUSE, mocks.pause],
      [BATCH_IPC.RESUME, mocks.resume],
      [BATCH_IPC.STOP, mocks.stop]
    ] as const) {
      const handler = mocks.handlers.get(channel)!
      handler({}, 'queue-a')
      expect(method).toHaveBeenLastCalledWith('queue-a')
      expect(() => handler({}, {})).toThrow('标识')
      handler({})
      expect(method).toHaveBeenLastCalledWith(undefined)
    }
  })
})
