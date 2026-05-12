import type {
  AutomatedPipelineStage,
  PipelineContext,
  PipelineState
} from '@shared/types'
import {
  PIPELINE_STAGE_ORDER,
  PIPELINE_TERMINAL_STATES
} from './state-machine-meta'

export type TerminalStateSubscriber = (state: PipelineState) => void

export function shouldStopPipelineExecution(
  context: PipelineContext,
  aborted: boolean
): boolean {
  return (
    aborted ||
    context.state === 'paused' ||
    context.state === 'error' ||
    context.state === 'idle'
  )
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

export function performAbort(params: {
  onAborted: () => void
  onPausedStateCleared: () => void
  onErrorCleared: () => void
  onStateChange: (state: PipelineState) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
}): void {
  params.onAborted()
  params.onLog('warn', 'aborted', '⏹ 流水线已中止')
  params.onPausedStateCleared()
  params.onErrorCleared()
  params.onStateChange('idle')
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

export function getRetryStageSequence(
  stage: AutomatedPipelineStage
): AutomatedPipelineStage[] {
  const startIdx = PIPELINE_STAGE_ORDER.indexOf(stage)
  return PIPELINE_STAGE_ORDER.slice(startIdx)
}

export function waitForTerminalState(
  context: PipelineContext,
  subscribe: (listener: TerminalStateSubscriber) => void,
  unsubscribe: (listener: TerminalStateSubscriber) => void
): Promise<{ state: PipelineState; stage: AutomatedPipelineStage }> {
  if (PIPELINE_TERMINAL_STATES.includes(context.state)) {
    return Promise.resolve({
      state: context.state,
      stage: context.currentStage
    })
  }

  return new Promise((resolve) => {
    const onStateChange = (state: PipelineState) => {
      if (PIPELINE_TERMINAL_STATES.includes(state)) {
        unsubscribe(onStateChange)
        resolve({ state, stage: context.currentStage })
      }
    }
    subscribe(onStateChange)
  })
}
