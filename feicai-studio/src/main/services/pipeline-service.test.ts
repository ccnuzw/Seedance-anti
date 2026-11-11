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
  isPipelineBusy
} from './pipeline-service'
import {
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
  return {
    setProvider: vi.fn(),
    setPipelineSettings: vi.fn(),
    start: vi
      .fn<(params: unknown) => Promise<void>>()
      .mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    isRunning: () => false,
    getContext: () => ({ state: 'director_done', currentStage: 'director' })
  }
}

describe('pipeline runtime admission and settling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
