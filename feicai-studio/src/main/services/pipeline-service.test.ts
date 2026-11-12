import { EventEmitter } from 'events'
import type { PipelineContext } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FileSystem from 'fs'
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  project: vi.fn(),
  provider: vi.fn(),
  read: vi.fn()
}))
vi.mock('../db/llm-config-repository', () => ({
  getDefaultLLMConfig: mocks.config
}))
vi.mock('./production-commit-service', () => ({
  recoverProductionCommits: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./project-service', () => ({ resolveProjectConfig: mocks.project }))
vi.mock('../llm/provider-factory', () => ({ createProvider: mocks.provider }))
vi.mock('fs', async (original) => ({
  ...(await original<typeof FileSystem>()),
  readFileSync: mocks.read
}))
import {
  launchPipeline,
  runWorkflowAction,
  abortPipeline,
  isPipelineBusy,
  pausePipeline,
  resumePipeline,
  retryPipeline,
  skipPipelineReview,
  bindPipelineRuntime,
  listPipelineTasks,
  getPipelineTask,
  getPipelineContext,
  resetPipelineTasks,
  setPipelineTaskSink
} from './pipeline-service'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease
} from './batch-execution-lease'

const params = {
  projectId: 'p',
  projectPath: '/tmp/project',
  episodeNum: 1,
  projectName: '项目',
  visualStyle: '写实',
  targetMedium: '短剧'
}
function engine() {
  const context = {
    ...params,
    state: 'director_done',
    currentStage: 'director',
    logs: [],
    reviews: []
  } as unknown as PipelineContext
  return Object.assign(new EventEmitter(), {
    setProvider: vi.fn(),
    setPipelineSettings: vi.fn(),
    start: vi
      .fn<(input: unknown) => Promise<void>>()
      .mockImplementation(async (input) => {
        const supplied = input as PipelineContext
        Object.assign(context, {
          projectId: supplied.projectId,
          episodeNum: supplied.episodeNum,
          runId: supplied.runId
        })
      }),
    abort: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    skipReview: vi.fn().mockResolvedValue(undefined),
    isRunning: () => false,
    getContext: () => ({ ...context })
  })
}

describe('pipeline runtime admission and settling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPipelineTasks()
    mocks.config.mockReturnValue({ model: 'test', apiKey: 'never-used' })
    mocks.project.mockReturnValue({ projectName: '项目' })
    mocks.provider.mockReturnValue({})
    mocks.read.mockReturnValue('{}')
  })
  afterEach(() => {
    const lease = getExecutionLease()
    if (lease) releaseExecutionLease(lease)
  })

  it.each([
    '{bad',
    'null',
    '[]',
    '{"pipelineSettings":null}',
    '{"pipelineSettings":{"maxRetries":-1}}',
    '{"pipelineSettings":{"durationMin":200}}'
  ])(
    'blocks invalid disk config %s before starting either runtime',
    async (raw) => {
      mocks.read.mockReturnValue(raw)
      const first = engine()
      await expect(
        launchPipeline(first as never, params, { waitForCompletion: true })
      ).rejects.toThrow('读取流水线配置失败')
      expect(first.start).not.toHaveBeenCalled()
      expect(getExecutionLease()).toBeNull()
      const runner = { setProvider: vi.fn(), runScriptReview: vi.fn() }
      await expect(
        runWorkflowAction(runner as never, 'runScriptReview', params)
      ).rejects.toThrow('读取流水线配置失败')
      expect(runner.runScriptReview).not.toHaveBeenCalled()
      expect(getExecutionLease()).toBeNull()
    }
  )

  it('defaults only for a missing file; permission failures remain visible', async () => {
    mocks.read.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    const first = engine()
    await launchPipeline(first as never, params, { waitForCompletion: true })
    expect(first.setPipelineSettings).toHaveBeenCalledWith(
      expect.objectContaining({ passScore: 7 })
    )
    mocks.read.mockImplementation(() => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    await expect(
      launchPipeline(engine() as never, params, { waitForCompletion: true })
    ).rejects.toThrow('denied')
  })

  it('gives workflow generation and credentials the same effective disk settings', async () => {
    mocks.read.mockReturnValue(
      '{"pipelineSettings":{"durationMin":200,"durationMax":300,"passScore":9}}'
    )
    mocks.project.mockReturnValue({
      pipelineSettings: { durationMin: 20, passScore: 2 }
    })
    const runner = {
      setProvider: vi.fn(),
      runScriptReview: vi.fn().mockResolvedValue({})
    }
    await runWorkflowAction(runner as never, 'runScriptReview', params)
    expect(runner.runScriptReview).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({
          pipelineSettings: expect.objectContaining({
            durationMin: 200,
            durationMax: 300,
            passScore: 9,
            maxRetries: 3
          })
        }),
        projectContext: expect.objectContaining({
          durationMin: 200,
          durationMax: 300
        })
      })
    )
  })

  it('holds a synchronous shared lease before provider configuration/async execution', async () => {
    const gate = Promise.withResolvers<void>()
    const first = engine()
    first.start.mockReturnValue(gate.promise)
    const running = launchPipeline(first as never, params, {
      waitForCompletion: true
    })
    expect(isPipelineBusy(first as never)).toBe(true)
    const second = engine()
    await expect(
      launchPipeline(second as never, params, { waitForCompletion: true })
    ).rejects.toThrow('正在执行')
    expect(second.setProvider).not.toHaveBeenCalled()
    const runner = { setProvider: vi.fn(), runScriptReview: vi.fn() }
    await expect(
      runWorkflowAction(runner as never, 'runScriptReview', params)
    ).rejects.toThrow('正在执行')
    expect(runner.setProvider).not.toHaveBeenCalled()
    gate.resolve()
    await running
    expect(getExecutionLease()).toBeNull()
  })

  it('does not report stop complete or admit a new run until the old provider settles', async () => {
    const gate = Promise.withResolvers<void>()
    const first = engine()
    first.start.mockReturnValue(gate.promise)
    await launchPipeline(first as never, params, { waitForCompletion: false })
    let stopped = false
    const stopping = abortPipeline(first as never).then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(getExecutionLease()?.signal.aborted).toBe(true)
    await expect(
      launchPipeline(engine() as never, params, { waitForCompletion: true })
    ).rejects.toThrow()
    gate.resolve()
    await stopping
    expect(stopped).toBe(true)
    expect(getExecutionLease()).toBeNull()
  })

  it('releases the lease when initialization fails, allowing the next independent job', async () => {
    mocks.config.mockReturnValueOnce(null)
    await expect(
      launchPipeline(engine() as never, params, { waitForCompletion: true })
    ).rejects.toThrow('配置')
    expect(getExecutionLease()).toBeNull()
    await expect(
      launchPipeline(engine() as never, params, { waitForCompletion: true })
    ).resolves.toMatchObject({ success: true })
  })

  it('isolates sequential projects, captures provider/settings, and gives retries a new run without changing operationId recovery', async () => {
    const provider = { model: 'first-model', apiKey: 'private-first' }
    const project = {
      projectName: 'first',
      directories: { scripts: 'first-scripts' }
    }
    mocks.config.mockReturnValue(provider)
    mocks.project.mockReturnValue(project)
    mocks.read.mockReturnValue('{"pipelineSettings":{"passScore":9}}')
    const first = engine()
    const firstResult = await launchPipeline(first as never, params, {
      waitForCompletion: true,
      operationId: 'recovery-step'
    })
    const firstArgs = first.start.mock.calls[0]![0] as {
      operationId: string
      runId: string
      projectConfig: unknown
    }
    expect(firstArgs.operationId).toBe('recovery-step')
    expect(firstArgs.runId).not.toBe('recovery-step')
    provider.model = 'changed-model'
    provider.apiKey = 'changed-secret'
    project.directories.scripts = 'changed-scripts'
    expect(first.setProvider.mock.calls[0]![0]).toEqual({
      model: 'first-model',
      apiKey: 'private-first'
    })
    expect(firstArgs.projectConfig).toMatchObject({
      directories: { scripts: 'first-scripts' }
    })
    mocks.read.mockReturnValue('{"pipelineSettings":{"passScore":6}}')
    const retried = engine()
    await retryPipeline(retried as never, 'art', firstResult.identity!)
    expect(retried.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'recovery-step',
        startStage: 'art'
      })
    )
    expect(retried.setProvider.mock.calls[0]![0]).toMatchObject({
      model: 'first-model'
    })
    expect(retried.setPipelineSettings.mock.calls[0]![0]).toMatchObject({
      passScore: 9
    })
    const retryIdentity = listPipelineTasks()[0]!.identity
    expect(retryIdentity.taskId).toBe(firstResult.identity!.taskId)
    expect(retryIdentity.runId).not.toBe(firstResult.identity!.runId)
    const second = engine()
    const secondResult = await launchPipeline(
      second as never,
      { ...params, projectId: 'second-project', projectPath: '/tmp/second' },
      { waitForCompletion: true }
    )
    expect(secondResult.identity).toMatchObject({ projectId: 'second-project' })
    expect(secondResult.identity!.taskId).not.toBe(firstResult.identity!.taskId)
    expect(second.setPipelineSettings.mock.calls[0]![0]).toMatchObject({
      passScore: 6
    })
    expect(getPipelineTask(firstResult.identity!.taskId)).toBeNull()
    expect(JSON.stringify(listPipelineTasks())).not.toMatch(
      /apiKey|private-first|changed-secret/
    )
  })

  it.each([true, false])(
    'preserves operationId and launch scope across repeated retries (singleStage=%s)',
    async (singleStage) => {
      const first = engine()
      const launched = await launchPipeline(
        first as never,
        { ...params, startStage: 'director', singleStage },
        {
          waitForCompletion: true,
          operationId: 'durable-stage-operation'
        }
      )
      const second = engine()
      await retryPipeline(second as never, undefined, launched.identity!)
      const secondIdentity = listPipelineTasks()[0]!.identity
      expect(second.start).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'durable-stage-operation',
          startStage: 'director',
          singleStage,
          runId: secondIdentity.runId
        })
      )
      const third = engine()
      await retryPipeline(third as never, 'art', secondIdentity)
      const thirdIdentity = listPipelineTasks()[0]!.identity
      expect(third.start).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'durable-stage-operation',
          startStage: 'art',
          singleStage,
          runId: thirdIdentity.runId
        })
      )
      expect(secondIdentity.taskId).toBe(launched.identity!.taskId)
      expect(thirdIdentity.taskId).toBe(launched.identity!.taskId)
      expect(
        new Set([
          launched.identity!.runId,
          secondIdentity.runId,
          thirdIdentity.runId
        ]).size
      ).toBe(3)
    }
  )

  it('fences every targeted control before touching the current engine or lease', async () => {
    const first = engine()
    const gate = Promise.withResolvers<void>()
    first.start.mockReturnValue(gate.promise)
    const started = await launchPipeline(first as never, params, {
      waitForCompletion: false
    })
    const target = started.identity!
    for (const stale of [
      { ...target, taskId: 'old-task' },
      { ...target, runId: 'old-run' },
      { ...target, projectId: 'other-project' },
      { ...target, episodeNum: 2 }
    ]) {
      expect(() => pausePipeline(first as never, stale)).toThrow('失效')
      expect(() => resumePipeline(first as never, stale)).toThrow('失效')
      await expect(abortPipeline(first as never, stale)).rejects.toThrow('失效')
      await expect(
        retryPipeline(first as never, undefined, stale)
      ).rejects.toThrow('失效')
      await expect(
        skipPipelineReview(first as never, undefined, stale)
      ).rejects.toThrow('失效')
    }
    expect(first.pause).not.toHaveBeenCalled()
    expect(first.abort).not.toHaveBeenCalled()
    expect(getExecutionLease()?.signal.aborted).toBe(false)
    pausePipeline(first as never, target)
    expect(getExecutionLease()?.isPaused).toBe(true)
    resumePipeline(first as never, target)
    expect(getExecutionLease()?.isPaused).toBe(false)
    gate.resolve()
    await getExecutionLease()!.wait()
    expect(() => pausePipeline(first as never, target)).toThrow('活动任务')
  })

  it('adds identity to every forwarded event, rejects stale events and releases listeners and the runtime reference', async () => {
    const first = engine()
    const emit = vi.fn()
    const release = vi.fn()
    bindPipelineRuntime(first as never, { emit, release })
    const gate = Promise.withResolvers<void>()
    first.start.mockReturnValue(gate.promise)
    const result = await launchPipeline(first as never, params, {
      waitForCompletion: false
    })
    const identity = result.identity!
    const events = [
      'stateChanged',
      'log',
      'stream',
      'stageComplete',
      'reviewResult',
      'error'
    ]
    for (const event of events) {
      first.emit(event, {
        runId: identity.runId,
        context: first.getContext(),
        newState: 'director_done',
        chunk: 'x'
      })
      expect(emit).toHaveBeenLastCalledWith(
        event,
        expect.objectContaining({
          identity: expect.objectContaining(identity),
          taskId: identity.taskId,
          runId: identity.runId
        })
      )
    }
    emit.mockClear()
    first.emit('log', { runId: 'stale-run' })
    first.emit('stateChanged', {
      context: { ...first.getContext(), runId: 'stale-run' }
    })
    expect(emit).not.toHaveBeenCalled()
    expect(getPipelineContext(first as never)).toMatchObject({
      taskId: identity.taskId,
      runId: identity.runId,
      running: true
    })
    gate.resolve()
    await getExecutionLease()!.wait()
    expect(release).toHaveBeenCalledTimes(1)
    for (const event of events) expect(first.listenerCount(event)).toBe(0)
    expect(getPipelineContext(first as never)).toMatchObject({
      taskId: identity.taskId,
      runId: identity.runId,
      running: false
    })
    emit.mockClear()
    first.emit('log', { runId: identity.runId })
    expect(emit).not.toHaveBeenCalled()
  })

  it('observes independent workflows in the same task registry and captures inputs before waiting', async () => {
    const provider = { model: 'workflow-model', apiKey: 'private-workflow' }
    mocks.config.mockReturnValue(provider)
    const gate = Promise.withResolvers<{ success: boolean }>()
    const runner = {
      setProvider: vi.fn(),
      runScriptReview: vi.fn().mockReturnValue(gate.promise)
    }
    const sink = vi.fn()
    setPipelineTaskSink(sink)
    const execution = runWorkflowAction(
      runner as never,
      'runScriptReview',
      params
    )
    provider.model = 'changed'
    mocks.read.mockReturnValue('{"pipelineSettings":{"passScore":10}}')
    await vi.waitFor(() => expect(mocks.provider).toHaveBeenCalled())
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'workflow-model' })
    )
    const snapshot = listPipelineTasks()[0]!
    expect(snapshot).toMatchObject({
      kind: 'workflow',
      identity: {
        projectId: params.projectId,
        episodeNum: 1,
        stage: 'script_review'
      },
      settings: { passScore: 7 }
    })
    expect(JSON.stringify(snapshot)).not.toContain('private-workflow')
    expect(() =>
      pausePipeline(engine() as never, { ...snapshot.identity, runId: 'old' })
    ).toThrow()
    await expect(
      launchPipeline(engine() as never, params, { waitForCompletion: true })
    ).rejects.toThrow('正在执行')
    gate.resolve({ success: true })
    await execution
    expect(listPipelineTasks()[0]!.status).toBe('completed')
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('rejects automatic pipeline context queries during an independent workflow instead of projecting a new idle engine', async () => {
    const gate = Promise.withResolvers<{ success: boolean }>()
    const runner = {
      setProvider: vi.fn(),
      runScriptReview: vi.fn().mockReturnValue(gate.promise)
    }
    const execution = runWorkflowAction(
      runner as never,
      'runScriptReview',
      params
    )
    await Promise.resolve()
    // No pipeline has been launched; this is the unrelated idle instance that
    // a legacy getPipelineRuntime() query would create.
    const idle = engine()
    const idleContext = { ...idle.getContext(), state: 'idle' as const }
    const readIdleContext = vi
      .spyOn(idle, 'getContext')
      .mockReturnValue(idleContext)
    const workflow = listPipelineTasks()[0]!
    try {
      expect(workflow).toMatchObject({
        kind: 'workflow',
        status: 'running',
        identity: { projectId: 'p', stage: 'script_review' }
      })
      expect(() => getPipelineContext(idle as never)).toThrow('独立工作流')
      expect(readIdleContext).not.toHaveBeenCalled()
      expect(getPipelineTask(workflow.identity.taskId)).toEqual(workflow)
    } finally {
      gate.resolve({ success: true })
      await execution
    }
  })

  it('records rejected execution as failed and releases listeners and its lease', async () => {
    const first = engine()
    const release = vi.fn()
    bindPipelineRuntime(first as never, { emit: vi.fn(), release })
    first.start.mockRejectedValueOnce(new Error('execution failed'))
    await expect(
      launchPipeline(first as never, params, { waitForCompletion: true })
    ).rejects.toThrow('execution failed')
    expect(listPipelineTasks()[0]!.status).toBe('failed')
    expect(first.listenerCount('stateChanged')).toBe(0)
    expect(release).toHaveBeenCalled()
    expect(getExecutionLease()).toBeNull()
  })

  it('captures workflow settings, provider and parameters before a paused batch resumes', async () => {
    const lease = acquireExecutionLease('batch')
    lease.pause()
    const provider = { apiKey: 'private-key', model: 'captured-model' }
    mocks.config.mockReturnValue(provider)
    mocks.read.mockReturnValue(
      JSON.stringify({ pipelineSettings: { maxRetries: 2 } })
    )
    const runner = {
      setProvider: vi.fn(),
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true })
    }
    const input = { ...params }
    const pending = runWorkflowAction(
      runner as never,
      'runStoryGeneration',
      input,
      lease
    )
    expect(listPipelineTasks()[0]!.identity).toMatchObject({
      projectId: 'p',
      episodeNum: 1,
      stage: 'story'
    })
    input.episodeNum = 99
    provider.model = 'later-model'
    provider.apiKey = 'later-secret'
    mocks.read.mockReturnValue(
      JSON.stringify({ pipelineSettings: { maxRetries: 9 } })
    )
    lease.resume()
    await pending
    expect(mocks.provider).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'captured-model',
        apiKey: 'private-key'
      })
    )
    expect(runner.runStoryGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeNum: 1,
        projectConfig: expect.objectContaining({
          pipelineSettings: expect.objectContaining({ maxRetries: 2 })
        })
      })
    )
    expect(JSON.stringify(listPipelineTasks())).not.toContain('private-key')
    expect(listPipelineTasks()[0]!.status).toBe('completed')
    expect(getExecutionLease()).toBe(lease)
  })

  it('rejects legacy controls when no unique task owns the execution lease', () => {
    expect(() => pausePipeline(engine() as never)).toThrow('任务不存在')
  })

  it('passes cancellation, fencing and the pause gate through to each fresh execution', async () => {
    const first = engine()
    await launchPipeline(first as never, params, { waitForCompletion: true })
    const supplied = first.start.mock.calls[0]![0] as unknown as {
      signal: AbortSignal
      runId: string
      waitUntilResumed: () => Promise<void>
    }
    expect(supplied.signal).toBeInstanceOf(AbortSignal)
    expect(supplied.runId).toBeTruthy()
    expect(supplied.waitUntilResumed).toBeTypeOf('function')
    const runner = {
      setProvider: vi.fn(),
      runScriptReview: vi
        .fn()
        .mockResolvedValue({ stage: 'script_review', success: true })
    }
    await runWorkflowAction(runner as never, 'runScriptReview', {
      ...params,
      batchNumber: 8
    })
    expect(runner.runScriptReview).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        batchNumber: 8
      })
    )
  })
})
