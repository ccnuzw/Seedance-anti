import { createElement } from 'react'
import type { ExecutionStatus } from '@shared/ipc-contracts'
import type { PipelineTaskSnapshot } from '@shared/pipeline-task'

type BackgroundState =
  'pending' | 'failed' | 'ready' | 'running' | 'paused' | 'stopping'

export function isBackgroundBusy(state: BackgroundState): boolean {
  return ['running', 'paused', 'stopping'].includes(state)
}

export function backgroundTaskLabel(task: PipelineTaskSnapshot | null): string {
  if (!task) return '后台制作任务'
  const kind = task.kind === 'workflow' ? '独立工作流' : '流水线任务'
  const stage = task.identity.stage ? `（${task.identity.stage}）` : ''
  return `${kind}${stage}`
}

export function isActiveTask(task: PipelineTaskSnapshot): boolean {
  return ['running', 'paused'].includes(task.status)
}

export function getBatchBackgroundView(
  execution: ExecutionStatus,
  tasks: PipelineTaskSnapshot[],
  projectId?: string
): {
  state: BackgroundState
  task: PipelineTaskSnapshot | null
  owner: ExecutionStatus['owner']
} {
  const task =
    tasks.find(
      (candidate) =>
        isActiveTask(candidate) &&
        (!projectId || candidate.identity.projectId === projectId)
    ) || null
  return {
    state: execution.busy
      ? execution.phase === 'paused'
        ? 'paused'
        : execution.phase === 'stopping'
          ? 'stopping'
          : 'running'
      : 'ready',
    task,
    owner: execution.owner
  }
}

export function getBackgroundControlRequest(
  state: Extract<BackgroundState, 'running' | 'paused'>,
  task: PipelineTaskSnapshot
): { action: 'pause' | 'resume'; target: PipelineTaskSnapshot['identity'] } {
  return {
    action: state === 'paused' ? 'resume' : 'pause',
    target: task.identity
  }
}

export function getBackgroundStopRequest(task: PipelineTaskSnapshot): {
  action: 'abort'
  target: PipelineTaskSnapshot['identity']
} {
  return { action: 'abort', target: task.identity }
}

export function canStartBatch(input: {
  autoMode: boolean
  hasWaterline: boolean
  waterlineDone: boolean
  selectedCount: number
  backgroundState: BackgroundState
  pipelineRunning: boolean
}): boolean {
  return (
    (input.autoMode
      ? input.hasWaterline && !input.waterlineDone
      : input.selectedCount > 0) &&
    input.backgroundState === 'ready' &&
    !input.pipelineRunning
  )
}

export function BatchStartButton({
  disabled,
  label,
  onClick
}: {
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return createElement(
    'button',
    { className: 'btn btn-primary btn-lg', onClick, disabled },
    `▶ ${label}`
  )
}

export async function refreshAfterExecutionReleases(options: {
  getStatus: () => Promise<ExecutionStatus>
  refresh: () => Promise<void>
  delay: (milliseconds: number) => Promise<void>
  maxAttempts?: number
  isCancelled?: () => boolean
}): Promise<'refreshed' | 'still-busy'> {
  const maxAttempts = options.maxAttempts ?? 5
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (options.isCancelled?.()) return 'still-busy'
    const status = await options.getStatus()
    if (!status.busy) {
      if (options.isCancelled?.()) return 'still-busy'
      await options.refresh()
      return 'refreshed'
    }
    if (attempt < maxAttempts) await options.delay(150 * (attempt + 1))
  }
  return 'still-busy'
}

export type { BackgroundState }
