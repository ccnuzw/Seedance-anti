import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { PipelineStateMachine } from '../engine/state-machine'
import { WorkflowStepRunner } from '../workflow/workflow-step-runner'
import { getSkillsDir } from './pipeline-service'

let pipeline: PipelineStateMachine | null = null
let workflowRunner: WorkflowStepRunner | null = null

function forwardToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

function setupPipelineEvents(engine: PipelineStateMachine): void {
  engine.on('stateChanged', (data) =>
    forwardToRenderer(IPC.PIPELINE_STATE_CHANGED, data)
  )
  engine.on('log', (data) => forwardToRenderer(IPC.PIPELINE_LOG, data))
  engine.on('stream', (data) => forwardToRenderer(IPC.PIPELINE_STREAM, data))
  engine.on('stageComplete', (data) =>
    forwardToRenderer(IPC.PIPELINE_STAGE_COMPLETE, data)
  )
  engine.on('reviewResult', (data) =>
    forwardToRenderer(IPC.PIPELINE_REVIEW_RESULT, data)
  )
  engine.on('error', (data) => forwardToRenderer(IPC.PIPELINE_ERROR, data))
}

export function getPipelineRuntime(): PipelineStateMachine {
  if (!pipeline) {
    pipeline = new PipelineStateMachine(getSkillsDir())
    setupPipelineEvents(pipeline)
  }
  return pipeline
}

export function getWorkflowRunnerRuntime(): WorkflowStepRunner {
  if (!workflowRunner) {
    workflowRunner = new WorkflowStepRunner(getSkillsDir())
  }
  return workflowRunner
}

export function resetPipelineRuntime(): void {
  pipeline = null
  workflowRunner = null
}
