import { BATCH_IPC, MODE_MAP, type BatchStartParams } from '@shared/batch'
import {
  assertEpisodeNumber,
  assertRegisteredProjectRoot
} from '../security/access-control'
import { registerSafeIpcHandler } from '../security/safe-ipc'
import { getBatchQueueRuntime } from '../services/pipeline-runtime-service'

export function validateBatchStartParams(value: unknown): BatchStartParams {
  if (!value || typeof value !== 'object') throw new Error('缺少批队列参数')
  const params = value as BatchStartParams
  if (
    typeof params.projectId !== 'string' ||
    !params.projectId ||
    params.projectId.length > 200
  )
    throw new Error('无效项目标识')
  if (typeof params.mode !== 'string' || !Object.hasOwn(MODE_MAP, params.mode))
    throw new Error('无效批队列模式')
  if (typeof params.projectPath !== 'string') throw new Error('无效项目路径')
  if (!Array.isArray(params.episodes) || params.episodes.length > 10000)
    throw new Error('无效批队列集数')
  for (const episode of params.episodes) assertEpisodeNumber(episode)
  return {
    projectId: params.projectId,
    projectPath: assertRegisteredProjectRoot(params.projectPath),
    mode: params.mode,
    episodes: [...new Set(params.episodes)]
  }
}

export function validateBatchTarget(value: unknown): string | undefined {
  if (value === undefined) return undefined // Existing capacity-one callers.
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new Error('无效队列标识')
  return value
}

export function registerBatchHandlers(): void {
  registerSafeIpcHandler(BATCH_IPC.START, (_event, params) =>
    getBatchQueueRuntime().start(validateBatchStartParams(params))
  )
  registerSafeIpcHandler(BATCH_IPC.GET_STATE, async () => {
    const queue = getBatchQueueRuntime()
    await queue.initialize()
    return queue.snapshot()
  })
  registerSafeIpcHandler(BATCH_IPC.PAUSE, (_event, queueId) =>
    getBatchQueueRuntime().pause(validateBatchTarget(queueId))
  )
  registerSafeIpcHandler(BATCH_IPC.RESUME, (_event, queueId) =>
    getBatchQueueRuntime().resume(validateBatchTarget(queueId))
  )
  registerSafeIpcHandler(BATCH_IPC.STOP, (_event, queueId) =>
    getBatchQueueRuntime().stop(validateBatchTarget(queueId))
  )
}
