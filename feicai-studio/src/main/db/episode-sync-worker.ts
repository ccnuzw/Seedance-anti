import { Worker } from 'node:worker_threads'
import type { Project } from '@shared/types'
import type { ProjectScanResult } from '../project-sync/scan'
import projectSyncWorkerPath from '../workers/project-sync-worker?modulePath'

export interface ProjectSyncRequest {
  mode: 'project' | 'episode'
  projectPath: string
  config?: Project['config']
  totalEpisodes: number
  episodeNumber?: number
}
interface ScanBatch {
  data: ProjectSyncRequest
  episodes: Set<number>
  dispatched: boolean
  promise: Promise<ProjectScanResult>
  resolve: (value: ProjectScanResult) => void
  reject: (error: Error) => void
}
interface PendingRequest {
  resolve: (value: ProjectScanResult) => void
  reject: (error: Error) => void
}
const batches = new Map<string, ScanBatch>()
const requests = new Map<number, PendingRequest>()
let worker: Worker | null = null
let nextRequestId = 0
let generation = 0
let idleTimer: NodeJS.Timeout | undefined

function scheduleIdleStop(): void {
  if (requests.size > 0 || !worker) return
  worker.unref()
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const idle = worker
    worker = null
    idleTimer = undefined
    if (idle) void idle.terminate()
  }, 30_000)
  idleTimer.unref()
}

function getWorker(): Worker {
  clearTimeout(idleTimer)
  idleTimer = undefined
  if (worker) {
    worker.ref()
    return worker
  }
  const instance = new Worker(projectSyncWorkerPath)
  worker = instance
  instance.on(
    'message',
    (message: { id: number; result?: ProjectScanResult; error?: string }) => {
      const pending = requests.get(message.id)
      if (!pending) return
      requests.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else if (message.result) pending.resolve(message.result)
      else pending.reject(new Error('扫描 worker 返回空结果'))
      scheduleIdleStop()
    }
  )
  const fail = (error: Error): void => {
    if (worker !== instance) return
    worker = null
    for (const pending of requests.values()) pending.reject(error)
    requests.clear()
    clearTimeout(idleTimer)
    idleTimer = undefined
  }
  instance.on('error', fail)
  instance.on('exit', (code) =>
    fail(new Error(`project sync worker exited before reply (code ${code})`))
  )
  return instance
}

function sendRequest(data: unknown): Promise<ProjectScanResult> {
  const { promise, resolve, reject } =
    Promise.withResolvers<ProjectScanResult>()
  try {
    const instance = getWorker()
    const id = ++nextRequestId
    requests.set(id, { resolve, reject })
    try {
      instance.postMessage({ id, data })
    } catch (error) {
      requests.delete(id)
      reject(error)
      scheduleIdleStop()
    }
  } catch (error) {
    reject(error)
  }
  return promise
}

export function runProjectSyncWorker<T>(data: ProjectSyncRequest): Promise<T> {
  const key = JSON.stringify([data.projectPath, data.config || null])
  let batch = batches.get(key)
  // A running full scan serves all single-episode callers it already covers.
  // Before dispatch, same-tick requests coalesce into one project/episode batch.
  const covered =
    batch &&
    (!batch.dispatched ||
      (batch.data.mode === 'project' &&
        (data.mode === 'project'
          ? data.totalEpisodes <= batch.data.totalEpisodes
          : (data.episodeNumber || 0) <= batch.data.totalEpisodes)) ||
      (data.mode === 'episode' && batch.episodes.has(data.episodeNumber!)))
  if (!covered) {
    const { promise, resolve, reject } =
      Promise.withResolvers<ProjectScanResult>()
    batch = {
      data: { ...data },
      episodes: new Set(),
      dispatched: false,
      promise,
      resolve,
      reject
    }
    batches.set(key, batch)
    const scheduledGeneration = generation
    const scheduled = batch
    queueMicrotask(() => {
      if (scheduledGeneration !== generation) {
        scheduled.reject(new Error('扫描 worker 已关闭'))
        return
      }
      scheduled.dispatched = true
      void sendRequest(
        scheduled.data.mode === 'project'
          ? scheduled.data
          : {
              ...scheduled.data,
              mode: 'episodes',
              episodeNumbers: [...scheduled.episodes]
            }
      )
        .then(scheduled.resolve, scheduled.reject)
        .finally(() => {
          if (batches.get(key) === scheduled) batches.delete(key)
        })
    })
  }
  if (!batch!.dispatched) {
    batch!.data.totalEpisodes = Math.max(
      batch!.data.totalEpisodes,
      data.totalEpisodes,
      data.episodeNumber || 0
    )
    if (data.mode === 'project') batch!.data.mode = 'project'
    if (data.episodeNumber) batch!.episodes.add(data.episodeNumber)
  }
  return batch!.promise.then((result) => {
    if (data.mode === 'project') return result as T
    const episode = result.episodes.find(
      (entry) => entry.episodeNumber === data.episodeNumber
    )
    if (!episode) throw new Error(`扫描未返回第 ${data.episodeNumber} 集`)
    return { hasSourceNovel: result.hasSourceNovel, episode } as T
  })
}

export async function invalidateProjectScanCache(
  projectPath?: string
): Promise<void> {
  if (!worker) return
  await sendRequest({ mode: 'invalidate', projectPath })
}

export async function shutdownProjectSyncWorker(): Promise<void> {
  clearTimeout(idleTimer)
  idleTimer = undefined
  generation++
  const instance = worker
  worker = null
  for (const pending of requests.values())
    pending.reject(new Error('扫描 worker 已关闭'))
  for (const batch of batches.values())
    batch.reject(new Error('扫描 worker 已关闭'))
  requests.clear()
  batches.clear()
  if (instance) await instance.terminate()
}
