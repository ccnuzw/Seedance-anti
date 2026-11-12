import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchQueueState } from '@shared/batch'
const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn()
}))
vi.mock('@renderer/services/batch-service', () => ({
  batchService: {
    onBatchState: mocks.subscribe,
    getBatchState: mocks.get,
    startBatch: mocks.start,
    pauseBatch: mocks.pause,
    resumeBatch: mocks.resume,
    stopBatch: mocks.stop
  }
}))
import { useBatchStore } from './batchStore'
function snapshot(status: BatchQueueState['status']): BatchQueueState {
  return {
    id: 'q',
    projectId: 'p',
    projectPath: '/project',
    mode: 'full',
    status,
    cursor: 0,
    tasks: [{ episodeNum: 1, status: 'pending', steps: {} }],
    updatedAt: new Date().toISOString()
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  useBatchStore.setState({ snapshot: null, commandPending: false, error: null })
})

describe('renderer observes main-owned queue', () => {
  it('reconnects to the durable queue without starting or stopping work on navigation', async () => {
    const disconnected = vi.fn()
    mocks.subscribe.mockReturnValue(disconnected)
    mocks.get.mockResolvedValue(snapshot('running'))
    const disconnect = useBatchStore.getState().connect()
    await useBatchStore.getState().refresh()
    expect(useBatchStore.getState().snapshot?.status).toBe('running')
    disconnect()
    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    const reconnect = useBatchStore.getState().connect()
    await useBatchStore.getState().refresh()
    expect(useBatchStore.getState().snapshot?.id).toBe('q')
    reconnect()
  })
  it('failed initialization releases the command UI and retains a visible error', async () => {
    mocks.start.mockRejectedValue(new Error('队列文件损坏'))
    await expect(
      useBatchStore.getState().start({
        projectId: 'p',
        projectPath: '/project',
        mode: 'full',
        episodes: [1]
      })
    ).rejects.toThrow('损坏')
    expect(useBatchStore.getState().commandPending).toBe(false)
    expect(useBatchStore.getState().error).toBe('队列文件损坏')
    mocks.start.mockResolvedValue(snapshot('running'))
    await useBatchStore.getState().start({
      projectId: 'p',
      projectPath: '/project',
      mode: 'full',
      episodes: [1]
    })
    expect(useBatchStore.getState().snapshot?.status).toBe('running')
  })
  it('resumes the observed interrupted queue with its identity', async () => {
    useBatchStore.setState({ snapshot: snapshot('interrupted') })
    mocks.resume.mockResolvedValue(snapshot('running'))
    await useBatchStore.getState().resume()
    expect(mocks.resume).toHaveBeenCalledWith('q')
    expect(useBatchStore.getState().snapshot?.status).toBe('running')
  })
  it('cannot control an unidentified queue through the legacy no-argument path', async () => {
    await expect(useBatchStore.getState().resume()).rejects.toThrow('队列身份')
    expect(mocks.resume).not.toHaveBeenCalled()
  })
  it('stop stays pending until main acknowledges real settlement', async () => {
    const gate = Promise.withResolvers<BatchQueueState>()
    mocks.stop.mockReturnValue(gate.promise)
    useBatchStore.setState({ snapshot: snapshot('running') })
    const stopping = useBatchStore.getState().stop()
    expect(mocks.stop).toHaveBeenCalledWith('q')
    expect(useBatchStore.getState().commandPending).toBe(true)
    gate.resolve(snapshot('stopped'))
    await stopping
    expect(useBatchStore.getState().commandPending).toBe(false)
    expect(useBatchStore.getState().snapshot?.status).toBe('stopped')
  })
})
