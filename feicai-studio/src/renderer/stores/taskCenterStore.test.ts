import { describe, expect, it, vi } from 'vitest'
import type { PipelineTaskSnapshot } from '@shared/pipeline-task'
import type { TaskCenterAPI } from '@renderer/services/task-center-service'
import {
  allowedTaskActions,
  createTaskCenterStore,
  taskKey
} from './taskCenterStore'
import { describeTask } from '@renderer/components/pipeline/TaskCenter-view'

function task(
  runId = 'new',
  status: PipelineTaskSnapshot['status'] = 'running',
  kind: PipelineTaskSnapshot['kind'] = 'pipeline'
): PipelineTaskSnapshot {
  return {
    identity: {
      projectId: 'project-a',
      taskId: runId,
      runId,
      episodeNum: 4,
      stage: 'script_review'
    },
    kind,
    status,
    settings: {} as PipelineTaskSnapshot['settings']
  }
}
function fixture() {
  let event = () => {}
  const api: TaskCenterAPI = {
    tasks: vi.fn(async () => [task()]),
    batch: vi.fn(async () => null),
    execution: vi.fn(async () => ({
      busy: true,
      phase: 'running' as const,
      owner: 'pipeline' as const
    })),
    control: vi.fn(async () => {}),
    controlBatch: vi.fn(async () => {}),
    subscribe: (refresh) => {
      event = refresh
      return () => {}
    }
  }
  return { api, store: createTaskCenterStore(api), emit: () => event() }
}

describe('global task center authoritative session state', () => {
  it('keeps identities and sticky terminal results until explicit acknowledgment', async () => {
    const { api, store } = fixture()
    await store.getState().refresh()
    vi.mocked(api.tasks).mockResolvedValue([task('new', 'failed')])
    vi.mocked(api.execution).mockResolvedValue({ busy: false, phase: 'idle' })
    await store.getState().refresh()
    expect(store.getState().acknowledged).toEqual([])
    await store.getState().refresh()
    expect(store.getState().entries[0]).toMatchObject({
      task: { status: 'failed' }
    })
    store.getState().acknowledge(taskKey(task()))
    expect(store.getState().acknowledged).toContain(taskKey(task()))
    vi.mocked(api.tasks).mockResolvedValue([task('next')])
    await store.getState().refresh()
    expect(store.getState().entries.map((entry) => entry.key)).toContain(
      taskKey(task())
    )
  })
  it('uses workflow task snapshots without pipeline state or fabricated percentages', async () => {
    const { api, store } = fixture()
    vi.mocked(api.tasks).mockResolvedValue([
      task('workflow', 'running', 'workflow')
    ])
    vi.mocked(api.execution).mockResolvedValue({
      busy: true,
      phase: 'running',
      owner: 'workflow'
    })
    await store.getState().refresh()
    const entry = store.getState().entries[0]
    expect(describeTask(entry)).toMatchObject({
      source: '独立工作流',
      progress: '正在审核 · 服务未提供细分步骤进度'
    })
    await store.getState().control(entry.key, 'pause')
    expect(api.control).toHaveBeenCalledWith({
      action: 'pause',
      target: task('workflow').identity
    })
  })
  it('fails closed on querying errors and gates paused/stopping/pending controls', async () => {
    const { api, store } = fixture()
    await store.getState().refresh()
    let entry = store.getState().entries[0]
    expect(allowedTaskActions(store.getState(), entry)).toEqual([
      'pause',
      'stop'
    ])
    vi.mocked(api.execution).mockResolvedValue({
      busy: true,
      phase: 'stopping',
      owner: 'pipeline'
    })
    await store.getState().refresh()
    expect(allowedTaskActions(store.getState(), entry)).toEqual([])
    vi.mocked(api.tasks).mockResolvedValue([task('new', 'paused')])
    vi.mocked(api.execution).mockResolvedValue({
      busy: true,
      phase: 'paused',
      owner: 'pipeline'
    })
    await store.getState().refresh()
    entry = store.getState().entries[0]
    expect(allowedTaskActions(store.getState(), entry)).toEqual([
      'resume',
      'stop'
    ])
    const wait = Promise.withResolvers<void>()
    vi.mocked(api.control).mockReturnValue(wait.promise)
    const stopping = store.getState().control(entry.key, 'stop')
    expect(store.getState().pending).toEqual({ key: entry.key, action: 'stop' })
    expect(allowedTaskActions(store.getState(), entry)).toEqual([])
    wait.resolve()
    await stopping
    vi.mocked(api.execution).mockRejectedValue(new Error('offline'))
    await store.getState().refresh()
    expect(store.getState().health).toBe('unknown')
    expect(allowedTaskActions(store.getState(), entry)).toEqual([])
    await expect(store.getState().control(entry.key, 'stop')).rejects.toThrow(
      '不可控制'
    )
  })
  it('invalidates reads on events and never trusts old run event payloads', async () => {
    const { api, store, emit } = fixture()
    const wait = Promise.withResolvers<PipelineTaskSnapshot[]>()
    vi.mocked(api.tasks)
      .mockReturnValueOnce(wait.promise)
      .mockResolvedValue([task('new')])
    const off = store.getState().connect()
    emit() // An announcement could contain any delayed old identity; payload is ignored.
    wait.resolve([task('old', 'completed')])
    await store.getState().refresh()
    expect(store.getState().entries.map((entry) => entry.key)).toEqual([
      taskKey(task('new'))
    ])
    off()
  })
  it('invalidates a disconnected in-flight read before reconnecting', async () => {
    const { api, store } = fixture()
    const wait = Promise.withResolvers<PipelineTaskSnapshot[]>()
    vi.mocked(api.tasks)
      .mockReturnValueOnce(wait.promise)
      .mockResolvedValue([task('reconnected')])
    const off = store.getState().connect()
    off()
    const offAgain = store.getState().connect()
    wait.resolve([task('disconnected', 'completed')])
    await store.getState().refresh()
    expect(store.getState().entries.map((entry) => entry.key)).toEqual([
      taskKey(task('reconnected'))
    ])
    offAgain()
  })
  it('retains an unacknowledged result when a newer run replaces the backend singleton', async () => {
    const { api, store } = fixture()
    vi.mocked(api.tasks).mockResolvedValue([task('first', 'completed')])
    vi.mocked(api.execution).mockResolvedValue({ busy: false, phase: 'idle' })
    await store.getState().refresh()
    vi.mocked(api.tasks).mockResolvedValue([task('second')])
    await store.getState().refresh()
    expect(store.getState().entries.map((entry) => entry.key)).toEqual([
      taskKey(task('second')),
      taskKey(task('first'))
    ])
    expect(store.getState().acknowledged).toEqual([])
  })
  it('uses only review state evidence for pipeline progress and never estimates percentages', async () => {
    const { api, store } = fixture()
    const running = task()
    running.context = { state: 'director_reviewing' } as NonNullable<
      PipelineTaskSnapshot['context']
    >
    vi.mocked(api.tasks).mockResolvedValue([running])
    await store.getState().refresh()
    expect(describeTask(store.getState().entries[0]).progress).toBe('正在审核')
    expect(describeTask(store.getState().entries[0]).progress).not.toContain(
      '%'
    )
  })
  it('marks vanished active runs unknown instead of inventing completion/recovery', async () => {
    const { api, store } = fixture()
    await store.getState().refresh()
    vi.mocked(api.tasks).mockResolvedValue([])
    vi.mocked(api.execution).mockResolvedValue({ busy: false, phase: 'idle' })
    await store.getState().refresh()
    expect(store.getState().entries[0].unknown).toBe(true)
    expect(
      allowedTaskActions(store.getState(), store.getState().entries[0])
    ).toEqual([])
    const restarted = createTaskCenterStore(api)
    await restarted.getState().refresh()
    expect(restarted.getState().entries).toEqual([])
  })
  it('keeps completed queue errors distinct and controls batch by queue identity', async () => {
    const { api, store } = fixture()
    vi.mocked(api.tasks).mockResolvedValue([])
    vi.mocked(api.batch).mockResolvedValue({
      id: 'q1',
      projectId: 'a',
      projectPath: '/synthetic',
      mode: 'script',
      status: 'running',
      cursor: 0,
      tasks: [{ episodeNum: 2, status: 'running', steps: {} }],
      updatedAt: '1'
    })
    vi.mocked(api.execution).mockResolvedValue({
      busy: true,
      phase: 'running',
      owner: 'batch'
    })
    await store.getState().refresh()
    await store.getState().control('batch:q1', 'pause')
    expect(api.controlBatch).toHaveBeenCalledWith('pause', 'q1')
    const batch = (await api.batch())!
    batch.status = 'completed'
    batch.cursor = 1
    batch.tasks[0].status = 'error'
    batch.tasks[0].progress = '审核失败'
    vi.mocked(api.batch).mockResolvedValue(batch)
    vi.mocked(api.execution).mockResolvedValue({ busy: false, phase: 'idle' })
    await store.getState().refresh()
    expect(describeTask(store.getState().entries[0])).toMatchObject({
      status: '队列已遍历完成 · 1 项失败',
      failure: '第 2 集：审核失败'
    })
    expect(
      allowedTaskActions(store.getState(), store.getState().entries[0])
    ).toEqual([])
  })
})
