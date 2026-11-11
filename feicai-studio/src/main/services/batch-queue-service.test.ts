import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchQueueState, BatchStartParams } from '@shared/batch'
import type { WorkflowActionResult } from '@shared/ipc-contracts'
const storage = vi.hoisted(() => ({
  files: new Map<string, string>(),
  fail: false
}))
vi.mock('../io/atomic-file', () => ({
  readJsonWithRecovery: async (path: string) => {
    if (storage.fail) throw new Error('队列文件损坏')
    const value = storage.files.get(path)
    return value ? JSON.parse(value) : null
  },
  atomicWriteFile: async (path: string, value: string) => {
    storage.files.set(path, value)
  }
}))
import { BatchQueue, type BatchQueueDeps } from './batch-queue-service'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease
} from './batch-execution-lease'

const params: BatchStartParams = {
  projectId: 'p',
  projectPath: '/project',
  mode: 'preproduction',
  episodes: [1, 2]
}
function fixture() {
  const completed = Promise.withResolvers<BatchQueueState>()
  const committed = Promise.withResolvers<void>()
  const deps: BatchQueueDeps = {
    describeProject: () => ({
      projectPath: '/project',
      projectName: '项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      allEpisodes: [1, 2]
    }),
    waterline: () => ({
      unusedEntries: 6,
      readyEpisodeNumbers: [1, 2],
      nextBatchNumber: 8,
      unprocessedChapterCount: 12,
      nextActionMode: 'script'
    }),
    workflow: vi.fn(async (action) => ({
      success: true,
      stage: action === 'runScriptReview' ? 'script_review' : 'script'
    })),
    pipeline: vi.fn(async () => ({
      success: true,
      state: 'episode_complete' as const,
      stage: 'storyboard' as const
    })),
    onChange: (state) => {
      if (Object.keys(state.tasks[0]?.steps || {}).length) committed.resolve()
      if (['completed', 'stopped', 'error'].includes(state.status))
        completed.resolve(state)
    }
  }
  return {
    deps,
    completed,
    committed,
    queue: new BatchQueue('/queue.json', deps)
  }
}

beforeEach(() => {
  storage.files.clear()
  storage.fail = false
})
afterEach(async () => {
  const lease = getExecutionLease()
  if (lease) {
    lease.abort()
    releaseExecutionLease(lease)
  }
})

describe('durable main-owned batch queue', () => {
  it('commits each substep and cursor and runs without a renderer connection', async () => {
    const { queue, deps, completed } = fixture()
    await queue.start(params)
    const state = await completed.promise
    expect(state.cursor).toBe(2)
    expect(state.tasks.map((task) => task.status)).toEqual(['done', 'done'])
    expect(deps.workflow).toHaveBeenCalledTimes(4)
    expect(JSON.parse(storage.files.get('/queue.json')!)).toMatchObject({
      mode: 'preproduction',
      cursor: 2,
      status: 'completed'
    })
  })

  it('pause retains the coroutine and lease; resume continues the next substep', async () => {
    const { queue, deps, completed, committed } = fixture()
    const generation = Promise.withResolvers<WorkflowActionResult>()
    const entered = Promise.withResolvers<void>()
    deps.workflow = vi.fn(async (action) => {
      if (action === 'runScriptGeneration') {
        entered.resolve()
        return generation.promise
      }
      return { success: true, stage: 'script_review' }
    })
    await queue.start({ ...params, episodes: [1] })
    await entered.promise
    await queue.pause()
    expect(() => acquireExecutionLease('independent-workflow')).toThrow(
      '正在执行'
    )
    generation.resolve({ success: true, stage: 'script' })
    await committed.promise
    expect(deps.workflow).toHaveBeenCalledTimes(1)
    expect(queue.snapshot()?.status).toBe('paused')
    await queue.resume()
    expect((await completed.promise).tasks[0]?.status).toBe('done')
    expect(deps.workflow).toHaveBeenCalledTimes(2)
  })

  it('stop waits for in-flight work to settle and prevents all later substeps', async () => {
    const { queue, deps } = fixture()
    const generation = Promise.withResolvers<WorkflowActionResult>()
    const entered = Promise.withResolvers<void>()
    deps.workflow = vi.fn(async () => {
      entered.resolve()
      return generation.promise
    })
    await queue.start(params)
    await entered.promise
    let stopped = false
    const stopping = queue.stop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(() => acquireExecutionLease('next')).toThrow()
    generation.resolve({ success: true, stage: 'script' })
    await stopping
    expect(deps.workflow).toHaveBeenCalledTimes(1)
    expect(queue.snapshot()?.status).toBe('stopped')
    expect(getExecutionLease()).toBeNull()
  })

  it('marks restart interrupted, requires explicit resume, and never reruns durable receipts or completed tasks', async () => {
    const saved: BatchQueueState = {
      id: 'old',
      projectId: 'p',
      projectPath: '/project',
      mode: 'preproduction',
      status: 'running',
      cursor: 1,
      updatedAt: 'now',
      tasks: [
        { episodeNum: 1, status: 'done', steps: {} },
        {
          episodeNum: 2,
          status: 'running',
          steps: { '0:runScriptGeneration': { success: true, stage: 'script' } }
        }
      ]
    }
    storage.files.set('/queue.json', JSON.stringify(saved))
    const { queue, deps, completed } = fixture()
    await queue.initialize()
    expect(queue.snapshot()?.status).toBe('interrupted')
    expect(deps.workflow).not.toHaveBeenCalled()
    await queue.resume()
    const state = await completed.promise
    expect(deps.workflow).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.workflow).mock.calls[0]?.[0]).toBe('runScriptReview')
    expect(state.cursor).toBe(2)
  })

  it('releases admission after initialization failure', async () => {
    const { queue, completed } = fixture()
    storage.fail = true
    await expect(queue.start(params)).rejects.toThrow('损坏')
    expect(getExecutionLease()).toBeNull()
    storage.fail = false
    await queue.start(params)
    await completed.promise
  })

  it('replenishes inventory with the current waterline batchNumber, not the episode number', async () => {
    const { queue, deps, completed } = fixture()
    let scriptAttempts = 0
    deps.workflow = vi.fn(async (action) => {
      if (action === 'runScriptGeneration' && scriptAttempts++ === 0)
        return { success: false, error: '缺少剧情库存' }
      return {
        success: true,
        stage: action === 'runStoryGeneration' ? 'story' : 'script_review'
      }
    })
    await queue.start({ ...params, episodes: [2] })
    await completed.promise
    const storyCall = vi
      .mocked(deps.workflow)
      .mock.calls.find(([action]) => action === 'runStoryGeneration')
    expect(storyCall?.[1]).toMatchObject({ episodeNum: 2, batchNumber: 8 })
  })
  it('recovers an artifact committed before its queue receipt without submitting that model call twice', async () => {
    storage.files.set(
      '/queue.json',
      JSON.stringify({
        id: 'old',
        projectId: 'p',
        projectPath: '/project',
        mode: 'preproduction',
        status: 'running',
        cursor: 0,
        updatedAt: 'now',
        tasks: [
          {
            episodeNum: 1,
            status: 'running',
            steps: {},
            inFlight: {
              key: '0:runScriptGeneration',
              action: 'runScriptGeneration',
              operationId: 'committed-operation'
            }
          }
        ]
      })
    )
    const { queue, deps, completed } = fixture()
    deps.recover = vi.fn(async () => ({
      success: true,
      stage: 'script',
      outputPath: '/project/script/ep01.md'
    }))
    await queue.initialize()
    await queue.resume()
    const state = await completed.promise
    expect(deps.recover).toHaveBeenCalledWith(
      'runScriptGeneration',
      expect.objectContaining({ episodeNum: 1 }),
      'committed-operation'
    )
    expect(
      vi.mocked(deps.workflow).mock.calls.map(([action]) => action)
    ).toEqual(['runScriptReview'])
    expect(state.tasks[0]?.status).toBe('done')
  })
})
