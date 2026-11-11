import type {
  AutomatedPipelineStage,
  PipelineContext,
  PipelineSettings,
  WorkflowStageId
} from './types'

/** Transport identity. Credentials, paths and provider configuration stay private. */
export interface PipelineRunIdentity {
  projectId: string
  taskId: string
  runId: string
  episodeNum?: number
  stage?: WorkflowStageId
}

export type PipelineControlTarget = Pick<
  PipelineRunIdentity,
  'projectId' | 'taskId' | 'runId'
> & { episodeNum?: number }

export interface PipelineStageControl {
  target: PipelineControlTarget
  stage?: AutomatedPipelineStage
}

export type PipelineControlAction =
  'pause' | 'resume' | 'abort' | 'retry' | 'skip'

export interface PipelineTaskControl {
  action: PipelineControlAction
  target: PipelineControlTarget
  stage?: AutomatedPipelineStage
}

export type PipelineRunEvent<T = Record<string, unknown>> = T & {
  identity: PipelineRunIdentity
}

/** Optional only for the legacy, capacity-one IPC adapter. */
export interface PipelineEventIdentity {
  identity?: PipelineRunIdentity
  runId?: string
}

export interface PipelineTaskSnapshot {
  identity: PipelineRunIdentity
  kind: 'pipeline' | 'workflow'
  status: 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
  settings: Readonly<PipelineSettings>
  context?: PipelineContext
}

export function samePipelineRun(
  left: PipelineControlTarget,
  right: PipelineControlTarget
): boolean {
  return (
    left.projectId === right.projectId &&
    left.taskId === right.taskId &&
    left.runId === right.runId &&
    (left.episodeNum === undefined ||
      right.episodeNum === undefined ||
      left.episodeNum === right.episodeNum)
  )
}
