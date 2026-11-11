import type { PipelineContext, PipelineState } from '@shared/types'

export function shouldStopPipelineExecution(
  context: PipelineContext,
  aborted: boolean
): boolean {
  return aborted || context.state === 'error' || context.state === 'idle'
}

export function performPause(params: {
  currentState: PipelineState
  onPausedStateSaved: (state: PipelineState) => void
  onStateChange: (state: PipelineState) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
}): void {
  if (params.currentState === 'paused' || params.currentState === 'idle') return
  params.onPausedStateSaved(params.currentState)
  params.onStateChange('paused')
  params.onLog('info', 'paused', '⏸ 流水线已暂停')
}

export function performResume(params: {
  currentState: PipelineState
  pausedState: PipelineState | null
  onStateChange: (state: PipelineState) => void
  onPausedStateCleared: () => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
}): void {
  if (params.currentState !== 'paused' || !params.pausedState) return
  params.onLog('info', 'resumed', '▶ 流水线已恢复')
  params.onStateChange(params.pausedState)
  params.onPausedStateCleared()
}
