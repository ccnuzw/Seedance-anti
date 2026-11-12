import type { BatchQueueState } from '@shared/batch'
import type { ExecutionStatus } from '@shared/ipc-contracts'
import type {
  PipelineTaskControl,
  PipelineTaskSnapshot
} from '@shared/pipeline-task'

export interface TaskCenterAPI {
  tasks(): Promise<PipelineTaskSnapshot[]>
  batch(): Promise<BatchQueueState | null>
  execution(): Promise<ExecutionStatus>
  control(request: PipelineTaskControl): Promise<void>
  controlBatch(
    action: 'pause' | 'resume' | 'stop',
    queueId: string
  ): Promise<unknown>
  subscribe(refresh: () => void): () => void
}

export const taskCenterService: TaskCenterAPI = {
  tasks: () => window.feicaiAPI.listPipelineTasks(),
  batch: () => window.feicaiAPI.getBatchState(),
  execution: () => window.feicaiAPI.getExecutionStatus(),
  async control(request) {
    const result = await window.feicaiAPI.controlPipelineTask(request)
    if (!result.success) throw new Error(result.error || '任务控制失败')
  },
  controlBatch(action, queueId) {
    if (action === 'pause') return window.feicaiAPI.pauseBatch(queueId)
    if (action === 'resume') return window.feicaiAPI.resumeBatch(queueId)
    return window.feicaiAPI.stopBatch(queueId)
  },
  subscribe(refresh) {
    const off = [
      window.feicaiAPI.onPipelineTaskChanged(refresh),
      window.feicaiAPI.onPipelineStateChanged(refresh),
      window.feicaiAPI.onBatchState(refresh)
    ]
    return () => off.forEach((unsubscribe) => unsubscribe())
  }
}
