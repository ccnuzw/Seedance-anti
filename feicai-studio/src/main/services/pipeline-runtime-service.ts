import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { BATCH_IPC } from '@shared/batch'
import { BatchQueue } from './batch-queue-service'
import {
  acquireExecutionLease,
  releaseExecutionLease,
  getExecutionLease,
  shutdownExecution
} from './batch-execution-lease'
import { flushPendingWrites } from '../io/atomic-file'
import {
  assertRegisteredProjectRoot,
  assertPathWithinProject
} from '../security/access-control'
import {
  getRegisteredProject,
  getRegisteredProjectPlotBreakdownSummary,
  listProjectEpisodes
} from './project-service'
import {
  launchPipeline,
  loadPipelineSettings,
  runWorkflowAction,
  bindPipelineRuntime,
  resetPipelineTasks,
  setPipelineTaskSink
} from './pipeline-service'
import { recoverBatchCommit } from './batch-queue-recovery'
import { IPC } from '@shared/ipc-channels'
import { PipelineStateMachine } from '../engine/state-machine'
import { WorkflowStepRunner } from '../workflow/workflow-step-runner'
import { getSkillsDir } from './pipeline-service'

let pipeline: PipelineStateMachine | null = null
let batchQueue: BatchQueue | null = null

function forwardToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

function setupPipelineEvents(engine: PipelineStateMachine): void {
  const channels: Record<string, string> = {
    stateChanged: IPC.PIPELINE_STATE_CHANGED,
    log: IPC.PIPELINE_LOG,
    stream: IPC.PIPELINE_STREAM,
    stageComplete: IPC.PIPELINE_STAGE_COMPLETE,
    reviewResult: IPC.PIPELINE_REVIEW_RESULT,
    error: IPC.PIPELINE_ERROR
  }
  bindPipelineRuntime(engine, {
    emit: (event, data) => forwardToRenderer(channels[event], data),
    release: () => {
      if (pipeline === engine) pipeline = null
    }
  })
  setPipelineTaskSink((snapshot) =>
    forwardToRenderer(IPC.PIPELINE_TASK_CHANGED, snapshot)
  )
}

export function getPipelineRuntime(): PipelineStateMachine {
  if (!pipeline) {
    pipeline = new PipelineStateMachine(getSkillsDir())
    setupPipelineEvents(pipeline)
  }
  return pipeline
}

export function getWorkflowRunnerRuntime(): WorkflowStepRunner {
  setPipelineTaskSink((snapshot) =>
    forwardToRenderer(IPC.PIPELINE_TASK_CHANGED, snapshot)
  )
  return new WorkflowStepRunner(getSkillsDir())
}

export function resetPipelineRuntime(): void {
  pipeline = null
  batchQueue = null
  resetPipelineTasks()
}

export function getBatchQueueRuntime(): BatchQueue {
  if (!batchQueue)
    batchQueue = new BatchQueue(
      join(app.getPath('userData'), 'batch-queue.json'),
      {
        describeProject(id, path) {
          const trusted = assertRegisteredProjectRoot(path)
          const project = getRegisteredProject(id)
          if (
            !project ||
            assertPathWithinProject(
              project.projectPath,
              project.projectPath
            ) !== trusted
          )
            throw new Error('批队列项目不存在或路径不匹配')
          return {
            projectPath: trusted,
            projectName: project.name,
            visualStyle: project.visualStyle,
            targetMedium: project.targetMedium,
            maxRetries: loadPipelineSettings(trusted).maxRetries,
            allEpisodes: listProjectEpisodes(id).map(
              (episode) => episode.episodeNumber
            )
          }
        },
        waterline: getRegisteredProjectPlotBreakdownSummary,
        workflow: (action, params, lease) =>
          runWorkflowAction(getWorkflowRunnerRuntime(), action, params, lease),
        pipeline: (params, lease, operationId) =>
          launchPipeline(getPipelineRuntime(), params, {
            waitForCompletion: true,
            lease,
            operationId
          }),
        onChange: (state) => forwardToRenderer(BATCH_IPC.STATE_CHANGED, state),
        recover: (action, params, operationId) => {
          const lease = getExecutionLease()
          if (!lease || lease.owner !== 'batch')
            throw new Error('批队列恢复租约已失效')
          return recoverBatchCommit(action, params, operationId, lease)
        }
      }
    )
  return batchQueue
}

export async function initializeRuntimeQueue(): Promise<void> {
  await getBatchQueueRuntime().initialize()
}

export function isRuntimeBusy(): boolean {
  return getExecutionLease() !== null || !!pipeline?.isRunning()
}

export async function withRuntimeLease<T>(
  owner: string,
  action: () => Promise<T>
): Promise<T> {
  const lease = acquireExecutionLease(owner)
  try {
    return await action()
  } finally {
    releaseExecutionLease(lease)
  }
}

export async function shutdownRuntime(): Promise<void> {
  await shutdownExecution()
  await pipeline?.abort()
  await flushPendingWrites()
}
