import { Worker } from 'node:worker_threads'
import projectSyncWorkerPath from '../workers/project-sync-worker?modulePath'

export function runProjectSyncWorker<T>(workerData: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(projectSyncWorkerPath, { workerData })
    let settled = false

    worker.once('message', (message) => {
      settled = true
      resolve(message as T)
    })
    worker.once('error', (error) => {
      settled = true
      reject(error)
    })
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`project sync worker exited with code ${code}`))
      }
    })
  })
}
