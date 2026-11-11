import { create } from 'zustand'
import type { BatchQueueState, BatchStartParams } from '@shared/batch'
import { batchService } from '@renderer/services/batch-service'

interface BatchStore {
  snapshot: BatchQueueState | null
  commandPending: boolean
  error: string | null
  connect(): () => void
  refresh(): Promise<void>
  start(params: BatchStartParams): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  stop(): Promise<void>
}
let connections = 0
let disconnect: (() => void) | null = null

export const useBatchStore = create<BatchStore>((set, get) => {
  const accept = (snapshot: BatchQueueState | null) => {
    const previous = get().snapshot
    if (
      snapshot &&
      previous?.id === snapshot.id &&
      snapshot.updatedAt < previous.updatedAt
    )
      return
    set({ snapshot, error: null })
  }
  const command = async (action: () => Promise<BatchQueueState | null>) => {
    if (get().commandPending) throw new Error('上一条队列命令仍在处理')
    set({ commandPending: true, error: null })
    try {
      accept(await action())
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '批队列命令失败' })
      throw error
    } finally {
      set({ commandPending: false })
    }
  }
  return {
    snapshot: null,
    commandPending: false,
    error: null,
    connect: () => {
      connections++
      if (!disconnect) disconnect = batchService.onBatchState(accept)
      void get()
        .refresh()
        .catch(() => {})
      let closed = false
      return () => {
        if (closed) return
        closed = true
        if (--connections === 0) {
          disconnect?.()
          disconnect = null
        }
      }
    },
    refresh: async () => {
      try {
        accept(await batchService.getBatchState())
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : '读取批队列失败'
        })
        throw error
      }
    },
    start: (params) => command(() => batchService.startBatch(params)),
    pause: () => command(batchService.pauseBatch),
    resume: () => command(batchService.resumeBatch),
    stop: () => command(batchService.stopBatch)
  }
})
