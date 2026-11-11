import type { BatchAPI } from '@shared/batch'

/** Scheduling is exclusively main-owned; renderer methods only send commands/observe snapshots. */
export const batchService: BatchAPI = {
  startBatch: (params) => window.feicaiAPI.startBatch(params),
  getBatchState: () => window.feicaiAPI.getBatchState(),
  pauseBatch: () => window.feicaiAPI.pauseBatch(),
  resumeBatch: () => window.feicaiAPI.resumeBatch(),
  stopBatch: () => window.feicaiAPI.stopBatch(),
  onBatchState: (callback) => window.feicaiAPI.onBatchState(callback)
}
