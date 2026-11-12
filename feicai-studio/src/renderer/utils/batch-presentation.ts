import type { BatchQueueState, BatchTaskState } from '@shared/batch'
import type { ProjectEntryStage } from '@shared/types'

export function defaultBatchMode(entry: ProjectEntryStage) {
  return entry === 'novel'
    ? 'smart_next'
    : entry === 'story'
      ? 'script'
      : 'full'
}
export function batchStatusLabel(
  status: BatchQueueState['status'] | 'idle',
  errors: number
) {
  if (status === 'completed')
    return errors ? '队列已结束，存在失败任务' : '队列已完成'
  const labels: Record<
    Exclude<BatchQueueState['status'], 'completed'> | 'idle',
    string
  > = {
    error: '队列执行失败',
    idle: '队列尚未启动',
    running: '队列进行中',
    paused: '队列已暂停',
    stopping: '队列正在停止',
    stopped: '队列已停止',
    interrupted: '队列已中断'
  }
  return labels[status]
}
export function batchTaskLabel(
  task: Pick<BatchTaskState, 'episodeNum' | 'batchNumber'>
) {
  return task.batchNumber != null
    ? `第 ${task.batchNumber} 批剧情`
    : `第 ${task.episodeNum} 集`
}
