import { beforeEach, describe, expect, it, vi } from 'vitest'
type RuntimeHandler = (
  event: unknown,
  input?: unknown
) => Promise<Record<string, unknown>>
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, RuntimeHandler>(),
  launch: vi.fn(),
  workflow: vi.fn(),
  engine: {},
  runner: {},
  root: vi.fn((path: string) => path),
  abort: vi.fn()
}))
vi.mock('../security/safe-ipc', () => ({
  registerSafeIpcHandler: (channel: string, handler: RuntimeHandler) =>
    mocks.handlers.set(channel, handler)
}))
vi.mock('../security/access-control', () => ({
  assertRegisteredProjectRoot: mocks.root,
  assertEpisodeNumber: (value: unknown) => {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 10000
    )
      throw new Error('无效集数')
  }
}))
vi.mock('../services/pipeline-service', () => ({
  launchPipeline: mocks.launch,
  runWorkflowAction: mocks.workflow,
  abortPipeline: mocks.abort,
  pausePipeline: vi.fn(),
  resumePipeline: vi.fn(),
  retryPipeline: vi.fn(),
  skipPipelineReview: vi.fn(),
  getPipelineContext: vi.fn()
}))
vi.mock('../services/pipeline-runtime-service', () => ({
  getPipelineRuntime: () => mocks.engine,
  getWorkflowRunnerRuntime: () => mocks.runner
}))
import { IPC } from '@shared/ipc-channels'
import { registerPipelineHandlers } from './pipeline-handlers'
const params = {
  projectId: 'p',
  projectPath: '/project',
  episodeNum: 1,
  projectName: '项目',
  visualStyle: '写实',
  targetMedium: '短剧'
}

describe('safe runtime IPC boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    registerPipelineHandlers()
  })
  it.each([
    IPC.PIPELINE_START,
    IPC.PIPELINE_RUN_AND_WAIT,
    IPC.WORKFLOW_RUN_SCRIPT_GENERATION
  ])(
    'rejects invalid episode parameters on %s before configuring a provider',
    async (channel) => {
      const result = await mocks.handlers.get(channel)!(
        {},
        { ...params, episodeNum: -1 }
      )
      expect(result).toMatchObject({ success: false, error: '无效集数' })
      expect(mocks.launch).not.toHaveBeenCalled()
      expect(mocks.workflow).not.toHaveBeenCalled()
    }
  )
  it('passes only transport data and validates production-stage enums', async () => {
    mocks.launch.mockResolvedValue({ success: true })
    await mocks.handlers.get(IPC.PIPELINE_START)!(
      {},
      { ...params, startStage: 'director', singleStage: true, signal: 'forged' }
    )
    expect(mocks.launch).toHaveBeenCalledWith(
      mocks.engine,
      expect.objectContaining({ startStage: 'director', singleStage: true }),
      { waitForCompletion: false }
    )
    expect(mocks.launch.mock.calls[0]![1]).not.toHaveProperty('signal')
    const invalid = await mocks.handlers.get(IPC.PIPELINE_START)!(
      {},
      { ...params, startStage: 'media' }
    )
    expect(invalid.success).toBe(false)
  })
  it('returns admission failures from the atomic runtime gate, not a racy state precheck', async () => {
    mocks.launch.mockRejectedValue(new Error('任务仍在停止中'))
    expect(
      await mocks.handlers.get(IPC.PIPELINE_START)!({}, params)
    ).toMatchObject({ success: false, error: '任务仍在停止中' })
  })
  it('awaits real cancellation settle before replying to stop', async () => {
    const gate = Promise.withResolvers<void>()
    mocks.abort.mockReturnValue(gate.promise)
    let replied = false
    const result = mocks.handlers.get(IPC.PIPELINE_ABORT)!({}).then(() => {
      replied = true
    })
    await Promise.resolve()
    expect(replied).toBe(false)
    gate.resolve()
    await result
    expect(replied).toBe(true)
  })
})
