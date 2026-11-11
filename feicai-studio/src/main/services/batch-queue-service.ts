import { randomUUID } from 'crypto'
import {
  MODE_MAP,
  buildBatchPipelineParams,
  isWorkflowBatchMode,
  resolveBatchExecutionEpisodes,
  resolveBatchRunProgress,
  runBatchWorkflowMode,
  type BatchStartParams,
  type BatchQueueState,
  type BatchWorkflowBaseParams,
  type BatchWorkflowDeps
} from '@shared/batch'
import type {
  PipelineStartParams,
  PipelineStartResult,
  WorkflowActionResult
} from '@shared/ipc-contracts'
import type { AutomatedPipelineStage } from '@shared/types'
import { atomicWriteFile, readJsonWithRecovery } from '../io/atomic-file'
import {
  acquireExecutionLease,
  releaseExecutionLease,
  type ExecutionLease
} from './batch-execution-lease'

export interface BatchQueueDeps {
  describeProject(
    id: string,
    path: string
  ): Omit<BatchWorkflowBaseParams, 'episodeNum'> & { allEpisodes: number[] }
  waterline(
    id: string
  ): NonNullable<
    Parameters<typeof resolveBatchExecutionEpisodes>[0]['waterline']
  >
  workflow(
    action: keyof BatchWorkflowDeps,
    params: BatchWorkflowBaseParams,
    lease: ExecutionLease
  ): Promise<WorkflowActionResult>
  pipeline(
    params: PipelineStartParams,
    lease: ExecutionLease,
    operationId?: string
  ): Promise<PipelineStartResult>
  onChange(state: BatchQueueState): void
  recover?(
    action: string,
    params: BatchWorkflowBaseParams,
    operationId: string
  ): Promise<WorkflowActionResult | PipelineStartResult | null>
}

/** The scheduler lives in main; views may disconnect without owning its coroutine. */
export class BatchQueue {
  private state: BatchQueueState | null = null
  private active: Promise<void> | null = null
  private lease: ExecutionLease | null = null
  private initialization: Promise<void> | null = null

  constructor(
    private readonly filePath: string,
    private readonly deps: BatchQueueDeps
  ) {}

  initialize(): Promise<void> {
    if (!this.initialization)
      this.initialization = this.load().catch((error) => {
        this.initialization = null
        throw error
      })
    return this.initialization
  }

  private async load(): Promise<void> {
    const saved = await readJsonWithRecovery<BatchQueueState>(this.filePath)
    if (!saved) return
    if (
      !Object.hasOwn(MODE_MAP, saved.mode) ||
      !Array.isArray(saved.tasks) ||
      !Number.isInteger(saved.cursor) ||
      saved.cursor < 0 ||
      saved.cursor > saved.tasks.length ||
      typeof saved.projectPath !== 'string' ||
      typeof saved.projectId !== 'string' ||
      saved.tasks.some(
        (task) =>
          !Number.isInteger(task.episodeNum) ||
          task.episodeNum < 1 ||
          task.episodeNum > 10000 ||
          !task.steps ||
          typeof task.steps !== 'object'
      )
    ) {
      throw new Error('持久化批队列格式损坏，不能静默重建')
    }
    this.state = saved
    if (['running', 'paused', 'stopping'].includes(saved.status)) {
      saved.status = 'interrupted'
      saved.error = '上次执行被中断。请显式恢复，已提交子步骤将保留。'
      for (const task of saved.tasks)
        if (task.status === 'running') task.status = 'pending'
      await this.persist()
    }
  }

  snapshot(): BatchQueueState | null {
    return this.state ? structuredClone(this.state) : null
  }

  private async persist(): Promise<void> {
    if (!this.state) return
    this.state.updatedAt = new Date().toISOString()
    await atomicWriteFile(this.filePath, JSON.stringify(this.state, null, 2))
    this.deps.onChange(this.snapshot()!)
  }

  async start(params: BatchStartParams): Promise<BatchQueueState> {
    const lease = acquireExecutionLease('batch')
    try {
      await this.initialize()
      if (this.state?.status === 'interrupted')
        throw new Error('存在中断批队列，请先恢复或停止，不能覆盖')
      const project = this.deps.describeProject(
        params.projectId,
        params.projectPath
      )
      const episodes = resolveBatchExecutionEpisodes({
        mode: params.mode,
        selectedEpisodes: params.episodes,
        allEpisodes: project.allEpisodes,
        waterline: this.deps.waterline(params.projectId)
      })
      if (!episodes.length) throw new Error('当前水位无需执行该模式')
      this.state = {
        id: randomUUID(),
        projectId: params.projectId,
        projectPath: params.projectPath,
        mode: params.mode,
        status: 'running',
        cursor: 0,
        tasks: episodes.map((episodeNum) => ({
          episodeNum,
          status: 'pending',
          steps: {}
        })),
        updatedAt: new Date().toISOString()
      }
      await this.persist()
      this.launch(lease)
      return this.snapshot()!
    } catch (error) {
      releaseExecutionLease(lease)
      throw error
    }
  }

  private launch(lease: ExecutionLease): void {
    this.lease = lease
    this.active = Promise.resolve()
      .then(() => this.run(lease))
      .catch(async (error) => {
        if (!this.state) return
        this.state.status = lease.signal.aborted ? 'stopped' : 'error'
        this.state.error = lease.signal.aborted
          ? undefined
          : error instanceof Error
            ? error.message
            : '批队列执行失败'
        await this.persist()
      })
      .finally(() => {
        this.active = null
        this.lease = null
        releaseExecutionLease(lease)
      })
    // IPC observes failures through the durable queue state; never leave an unhandled rejection.
    void this.active.catch(console.error)
  }

  private async run(lease: ExecutionLease): Promise<void> {
    const state = this.state!
    const project = this.deps.describeProject(
      state.projectId,
      state.projectPath
    )
    for (; state.cursor < state.tasks.length; state.cursor++) {
      await lease.checkpoint()
      const task = state.tasks[state.cursor]
      if (
        task.status === 'done' ||
        task.status === 'error' ||
        task.status === 'skipped'
      )
        continue
      const latestWaterline = this.deps.waterline(state.projectId)
      const waterline = task.initialWaterline || latestWaterline
      task.initialWaterline = waterline
      if (
        Object.keys(task.steps).length === 0 &&
        !task.inFlight &&
        ((state.mode === 'story_until_ready' && waterline.unusedEntries >= 6) ||
          (['story_until_ready', 'story_until_done'].includes(state.mode) &&
            waterline.unprocessedChapterCount === 0) ||
          (state.mode === 'script_until_empty' &&
            waterline.unusedEntries === 0))
      ) {
        for (const remaining of state.tasks.slice(state.cursor)) {
          remaining.status = 'skipped'
          remaining.progress = '当前水位无需继续'
        }
        state.cursor = state.tasks.length
        break
      }
      task.status = 'running'
      task.progress = '执行中'
      await this.persist()
      const startedAt = Date.now()
      let invocation = 0
      const receipt = async <
        T extends WorkflowActionResult | PipelineStartResult
      >(
        action: string,
        execute: (operationId: string) => Promise<T>
      ): Promise<T> => {
        await lease.checkpoint()
        const key = `${invocation++}:${action}`
        const committed = task.steps[key]
        if (committed) return committed as T
        const operationId =
          task.inFlight?.key === key ? task.inFlight.operationId : randomUUID()
        const recovered =
          task.inFlight?.key === key
            ? await this.deps.recover?.(
                action,
                {
                  ...project,
                  episodeNum: task.episodeNum,
                  batchNumber: task.batchNumber
                },
                operationId
              )
            : null
        task.inFlight = { key, operationId, action }
        await this.persist()
        const result = recovered ? (recovered as T) : await execute(operationId)
        if (
          lease.signal.aborted &&
          !result.success &&
          !('review' in result && result.review)
        ) {
          lease.signal.throwIfAborted()
        }
        task.steps[key] = result
        await this.persist()
        task.inFlight = undefined
        return result
      }
      try {
        const base: BatchWorkflowBaseParams = {
          ...project,
          episodeNum: task.episodeNum,
          plotBreakdown: waterline,
          getWaterline: async () => this.deps.waterline(state.projectId),
          checkpoint: () => lease.checkpoint()
        }
        const workflow = Object.fromEntries(
          [
            'runStoryGeneration',
            'runStoryReview',
            'runScriptGeneration',
            'runScriptReview'
          ].map((action) => [
            action,
            async (params: BatchWorkflowBaseParams) => {
              if (
                action === 'runStoryGeneration' ||
                action === 'runStoryReview'
              ) {
                task.batchNumber ??=
                  params.batchNumber ??
                  this.deps.waterline(state.projectId).nextBatchNumber
                params = { ...params, batchNumber: task.batchNumber }
                await this.persist()
              }
              return await receipt(action, (operationId) =>
                this.deps.workflow(
                  action as keyof BatchWorkflowDeps,
                  { ...params, operationId },
                  lease
                )
              )
            }
          ])
        ) as unknown as BatchWorkflowDeps
        const result = isWorkflowBatchMode(state.mode)
          ? await runBatchWorkflowMode(state.mode, base, workflow)
          : await this.runPipelineTask(
              state.mode,
              state.projectId,
              base,
              lease,
              receipt
            )
        await lease.checkpoint()
        const progress = resolveBatchRunProgress(
          result,
          state.mode,
          Math.round((Date.now() - startedAt) / 1000)
        )
        task.status = progress.status
        task.progress = progress.progress
        task.elapsed = progress.elapsed
      } catch (error) {
        if (lease.signal.aborted) {
          task.status = 'pending'
          task.progress = '已停止，可显式恢复未完成步骤'
          throw error
        }
        task.status = 'error'
        task.progress = error instanceof Error ? error.message : '执行失败'
      }
      if (
        state.mode === 'story_until_ready' &&
        task.status === 'done' &&
        state.cursor + 1 === state.tasks.length
      ) {
        const nextWaterline = this.deps.waterline(state.projectId)
        if (
          nextWaterline.unusedEntries < 6 &&
          nextWaterline.unprocessedChapterCount !== 0
        ) {
          if (state.tasks.length >= 10000)
            throw new Error('批队列达到安全上限，请检查库存水位后重新提交')
          const nextBatch = nextWaterline.nextBatchNumber
          if (nextBatch <= task.episodeNum)
            throw new Error('剧情库存水位未推进，已停止以避免重复付费调用')
          state.tasks.push({
            episodeNum: nextBatch,
            status: 'pending',
            steps: {}
          })
          await this.persist()
        }
      }
      // Cursor and results commit together. Recovery never reruns an acknowledged task.
      state.cursor++
      await this.persist()
      state.cursor--
    }
    state.status = 'completed'
    await this.persist()
  }

  private async runPipelineTask(
    mode: BatchQueueState['mode'],
    projectId: string,
    base: BatchWorkflowBaseParams,
    lease: ExecutionLease,
    receipt: <T extends WorkflowActionResult | PipelineStartResult>(
      action: string,
      execute: (operationId: string) => Promise<T>
    ) => Promise<T>
  ): Promise<PipelineStartResult> {
    const stages: AutomatedPipelineStage[] =
      mode === 'full'
        ? ['director', 'art', 'storyboard']
        : [MODE_MAP[mode].stage!]
    let result: PipelineStartResult = { success: false }
    for (const stage of stages) {
      result = await receipt(stage, (operationId) =>
        this.deps.pipeline(
          buildBatchPipelineParams({ ...base, projectId }, stage),
          lease,
          operationId
        )
      )
      if (!result.success) break
    }
    return result
  }

  async pause(): Promise<BatchQueueState | null> {
    if (this.lease && this.state?.status === 'running') {
      this.lease.pause()
      this.state.status = 'paused'
      await this.persist()
    }
    return this.snapshot()
  }

  async resume(): Promise<BatchQueueState | null> {
    if (this.lease && this.state?.status === 'paused') {
      this.state.status = 'running'
      await this.persist()
      this.lease.resume()
      return this.snapshot()
    }
    const lease = acquireExecutionLease('batch')
    try {
      await this.initialize()
      if (
        !this.state ||
        !['interrupted', 'stopped'].includes(this.state.status)
      )
        throw new Error('没有可恢复的批队列')
      this.deps.describeProject(this.state.projectId, this.state.projectPath)
      this.state.status = 'running'
      this.state.error = undefined
      await this.persist()
      this.launch(lease)
      return this.snapshot()
    } catch (error) {
      releaseExecutionLease(lease)
      throw error
    }
  }

  async stop(): Promise<BatchQueueState | null> {
    if (this.lease) {
      this.lease.abort()
      if (this.state) {
        this.state.status = 'stopping'
        await this.persist()
      }
      await this.active
    } else if (this.state?.status === 'interrupted') {
      this.state.status = 'stopped'
      await this.persist()
    }
    return this.snapshot()
  }
}
