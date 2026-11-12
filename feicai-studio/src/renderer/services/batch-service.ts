import { assertExecutionAvailable } from './task-center-admission'
import type { BatchAPI } from '@shared/batch'

/** Scheduling is exclusively main-owned; renderer methods only send commands/observe snapshots. */
export const batchService: BatchAPI = {
  startBatch: async (params) => {
    await assertExecutionAvailable()
    return window.feicaiAPI.startBatch(params)
  },
  getBatchState: () => window.feicaiAPI.getBatchState(),
  pauseBatch: (queueId) => window.feicaiAPI.pauseBatch(queueId),
  resumeBatch: (queueId) => window.feicaiAPI.resumeBatch(queueId),
  stopBatch: (queueId) => window.feicaiAPI.stopBatch(queueId),
  onBatchState: (callback) => window.feicaiAPI.onBatchState(callback)
}
