import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  invalidateProjectScanCache,
  runProjectSyncWorker,
  shutdownProjectSyncWorker
} from './episode-sync-worker'
import type { ProjectScanResult } from '../project-sync/scan'

const { Worker } = vi.hoisted(() => ({ Worker: vi.fn() }))
vi.mock('node:worker_threads', () => ({ Worker }))
vi.mock('../workers/project-sync-worker?modulePath', () => ({
  default: 'scan-worker'
}))

class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  ref = vi.fn()
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
}
const instances: FakeWorker[] = []
const result = {
  hasSourceNovel: false,
  episodeNumbers: [1, 2],
  episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }]
}

beforeEach(() => {
  vi.clearAllMocks()
  instances.length = 0
  Worker.mockImplementation(function () {
    const worker = new FakeWorker()
    instances.push(worker)
    return worker
  })
})
afterEach(async () => {
  await shutdownProjectSyncWorker()
  vi.useRealTimers()
})

describe('reusable project scan worker', () => {
  it('合并同项目全量与单集并发，完成后仍复用同一worker', async () => {
    const a = runProjectSyncWorker<ProjectScanResult>({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 2
    })
    const b = runProjectSyncWorker<ProjectScanResult>({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 2
    })
    const c = runProjectSyncWorker<{ episode: { episodeNumber: number } }>({
      mode: 'episode',
      projectPath: '/project',
      totalEpisodes: 2,
      episodeNumber: 1
    })
    await Promise.resolve()
    expect(Worker).toHaveBeenCalledTimes(1)
    expect(instances[0].postMessage).toHaveBeenCalledTimes(1)
    const request = instances[0].postMessage.mock.calls[0][0]
    instances[0].emit('message', { id: request.id, result })
    const [first, second, episode] = await Promise.all([a, b, c])
    expect(first).toBe(second)
    expect(episode.episode.episodeNumber).toBe(1)
    const next = runProjectSyncWorker<ProjectScanResult>({
      mode: 'project',
      projectPath: '/other',
      totalEpisodes: 2
    })
    await Promise.resolve()
    expect(Worker).toHaveBeenCalledTimes(1)
    const nextRequest = instances[0].postMessage.mock.calls[1][0]
    instances[0].emit('message', { id: nextRequest.id, result })
    await next
  })

  it('并发多个单集只派发一次定向episodes扫描，不升级全量扫描', async () => {
    const a = runProjectSyncWorker<{ episode: { episodeNumber: number } }>({
      mode: 'episode',
      projectPath: '/project',
      totalEpisodes: 30,
      episodeNumber: 1
    })
    const b = runProjectSyncWorker<{ episode: { episodeNumber: number } }>({
      mode: 'episode',
      projectPath: '/project',
      totalEpisodes: 30,
      episodeNumber: 2
    })
    await Promise.resolve()
    const request = instances[0].postMessage.mock.calls[0][0]
    expect(request.data).toMatchObject({
      mode: 'episodes',
      episodeNumbers: [1, 2]
    })
    expect(instances[0].postMessage).toHaveBeenCalledTimes(1)
    instances[0].emit('message', { id: request.id, result })
    expect((await a).episode.episodeNumber).toBe(1)
    expect((await b).episode.episodeNumber).toBe(2)
  })

  it('运行中的全量扫描也能接纳单集调用，退出无回复会拒绝而不是悬挂', async () => {
    const full = runProjectSyncWorker({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 30
    })
    await Promise.resolve()
    const single = runProjectSyncWorker({
      mode: 'episode',
      projectPath: '/project',
      totalEpisodes: 30,
      episodeNumber: 2
    })
    const failure = Promise.allSettled([full, single])
    expect(instances[0].postMessage).toHaveBeenCalledTimes(1)
    instances[0].emit('exit', 0)
    expect((await failure).map((entry) => entry.status)).toEqual([
      'rejected',
      'rejected'
    ])
  })

  it('shutdown取消尚未派发请求，不会在退出后创建新worker', async () => {
    const queued = runProjectSyncWorker({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 30
    })
    const failure = expect(queued).rejects.toThrow('关闭')
    await shutdownProjectSyncWorker()
    await failure
    expect(Worker).not.toHaveBeenCalled()
  })

  it('清缓存请求走现有worker且shutdown终止worker', async () => {
    const first = runProjectSyncWorker({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 2
    })
    await Promise.resolve()
    const request = instances[0].postMessage.mock.calls[0][0]
    instances[0].emit('message', { id: request.id, result })
    await first
    const invalidation = invalidateProjectScanCache('/project')
    const invalidate = instances[0].postMessage.mock.calls[1][0]
    expect(invalidate.data).toEqual({
      mode: 'invalidate',
      projectPath: '/project'
    })
    instances[0].emit('message', {
      id: invalidate.id,
      result: { hasSourceNovel: false, episodeNumbers: [], episodes: [] }
    })
    await invalidation
    await shutdownProjectSyncWorker()
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)
  })

  it('空闲30秒终止worker释放缓存，下次请求才重新创建', async () => {
    vi.useFakeTimers()
    const scan = runProjectSyncWorker({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 2
    })
    await Promise.resolve()
    const request = instances[0].postMessage.mock.calls[0][0]
    instances[0].emit('message', { id: request.id, result })
    await scan
    vi.advanceTimersByTime(30_000)
    expect(instances[0].terminate).toHaveBeenCalledTimes(1)
    const next = runProjectSyncWorker({
      mode: 'project',
      projectPath: '/project',
      totalEpisodes: 2
    })
    await Promise.resolve()
    expect(Worker).toHaveBeenCalledTimes(2)
    const nextRequest = instances[1].postMessage.mock.calls[0][0]
    instances[1].emit('message', { id: nextRequest.id, result })
    await next
  })
})
