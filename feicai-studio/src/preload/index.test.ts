import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc-channels'
import type { FeicaiAPI } from '@shared/ipc-contracts'

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn().mockResolvedValue({ success: true }),
  on: vi.fn(),
  removeListener: vi.fn()
}))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener
  }
}))

describe('pipeline identity preload adapter', async () => {
  await import('./index')
  const api = mocks.expose.mock.calls[0]![1] as FeicaiAPI
  const target = { projectId: 'project', taskId: 'task', runId: 'run' }

  beforeEach(() => vi.clearAllMocks())

  it('keeps legacy no-argument and stage controls intact', async () => {
    await api.pausePipeline()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_PAUSE)
    await api.abortPipeline()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_ABORT)
    await api.resumePipeline()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_RESUME)
    await api.retryPipeline('art')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_RETRY, 'art')
    await api.skipPipeline('director')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_SKIP, 'director')
    await api.getPipelineState()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_GET_STATE)
  })

  it('forwards supplied identities without discarding or converting them to legacy controls', async () => {
    await api.pausePipeline(target)
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_PAUSE, target)
    await api.abortPipeline(target)
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_ABORT, target)
    await api.resumePipeline(target)
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_RESUME, target)
    await api.retryPipeline({ target, stage: 'art' })
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_RETRY, {
      target,
      stage: 'art'
    })
    await api.skipPipeline({ target })
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_SKIP, { target })
    await api.getPipelineState(target)
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      IPC.PIPELINE_GET_STATE,
      target
    )
    await api.listPipelineTasks()
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_LIST_TASKS)
    await api.getPipelineTask('task')
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_GET_TASK, 'task')
    await api.controlPipelineTask({ action: 'pause', target })
    expect(mocks.invoke).toHaveBeenLastCalledWith(IPC.PIPELINE_CONTROL_TASK, {
      action: 'pause',
      target
    })
  })

  it('removes the exact task event listener when unsubscribed', () => {
    const callback = vi.fn()
    const cleanup = api.onPipelineTaskChanged(callback)
    const handler = mocks.on.mock.calls[0]![1]
    handler({}, { identity: target })
    expect(callback).toHaveBeenCalledWith({ identity: target })
    cleanup()
    expect(mocks.removeListener).toHaveBeenCalledWith(
      IPC.PIPELINE_TASK_CHANGED,
      handler
    )
  })
})
