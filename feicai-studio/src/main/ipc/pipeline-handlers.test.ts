import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const assertRegisteredProjectRoot = vi.fn((input: string) => input)
const isPipelineBusy = vi.fn(() => false)
const launchPipeline = vi.fn()
const runWorkflowAction = vi.fn()
const getPipelineRuntime = vi.fn(() => ({ id: 'engine' }))
const getWorkflowRunnerRuntime = vi.fn(() => ({ id: 'runner' }))
const pausePipeline = vi.fn()
const abortPipeline = vi.fn()
const resumePipeline = vi.fn()
const retryPipeline = vi.fn()
const skipPipelineReview = vi.fn()
const getPipelineContext = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../security/access-control', () => ({
  assertRegisteredProjectRoot
}))

vi.mock('../services/pipeline-service', () => ({
  abortPipeline,
  getPipelineContext,
  isPipelineBusy,
  launchPipeline,
  pausePipeline,
  resumePipeline,
  retryPipeline,
  runWorkflowAction,
  skipPipelineReview
}))

vi.mock('../services/pipeline-runtime-service', () => ({
  getPipelineRuntime,
  getWorkflowRunnerRuntime
}))

describe('pipeline-handlers', async () => {
  const { registerPipelineHandlers } = await import('./pipeline-handlers')
  const { IPC } = await import('@shared/ipc-channels')

  beforeEach(() => {
    handlers.clear()
    assertRegisteredProjectRoot
      .mockReset()
      .mockImplementation((input: string) => input)
    isPipelineBusy.mockReset().mockReturnValue(false)
    launchPipeline.mockReset()
    runWorkflowAction.mockReset()
    getPipelineRuntime.mockReset().mockReturnValue({ id: 'engine' })
    getWorkflowRunnerRuntime.mockReset().mockReturnValue({ id: 'runner' })
    pausePipeline.mockReset()
    abortPipeline.mockReset()
    resumePipeline.mockReset()
    retryPipeline.mockReset()
    skipPipelineReview.mockReset()
    getPipelineContext.mockReset()
    registerPipelineHandlers()
  })

  it('PIPELINE_START 会校验项目路径，并透传 startStage 和 singleStage', async () => {
    launchPipeline.mockResolvedValue({ success: true, message: 'ok' })

    const handler = handlers.get(IPC.PIPELINE_START)
    const payload = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      startStage: 'director',
      singleStage: true
    }

    const result = await handler?.({}, payload)

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(launchPipeline).toHaveBeenCalledWith(
      { id: 'engine' },
      { ...payload, projectPath: '/tmp/project' },
      { waitForCompletion: false }
    )
    expect(result).toEqual({ success: true, message: 'ok' })
  })

  it('PIPELINE_RUN_AND_WAIT 会在批量模式下等待完成并返回结果', async () => {
    launchPipeline.mockResolvedValue({
      success: true,
      state: 'art_done',
      stage: 'art'
    })

    const handler = handlers.get(IPC.PIPELINE_RUN_AND_WAIT)
    const payload = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 7,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      startStage: 'art',
      singleStage: true
    }

    const result = await handler?.({}, payload)

    expect(launchPipeline).toHaveBeenCalledWith(
      { id: 'engine' },
      { ...payload, projectPath: '/tmp/project' },
      { waitForCompletion: true }
    )
    expect(result).toEqual({ success: true, state: 'art_done', stage: 'art' })
  })

  it('PIPELINE_START 在流水线忙碌时会直接返回错误且不启动', async () => {
    isPipelineBusy.mockReturnValue(true)

    const handler = handlers.get(IPC.PIPELINE_START)
    const payload = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    }

    const result = await handler?.({}, payload)

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(launchPipeline).not.toHaveBeenCalled()
    expect(result).toEqual({ error: '流水线正在执行中，请先停止当前任务' })
  })

  it('PIPELINE_RUN_AND_WAIT 在启动异常时会返回错误消息', async () => {
    launchPipeline.mockRejectedValue(new Error('start failed'))

    const handler = handlers.get(IPC.PIPELINE_RUN_AND_WAIT)
    const result = await handler?.(
      {},
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 7,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      }
    )

    expect(result).toEqual({ error: 'start failed' })
  })

  it('控制类 handler 会透传到底层 pipeline service', async () => {
    pausePipeline.mockReturnValue({ success: true })
    abortPipeline.mockReturnValue({ success: true })
    resumePipeline.mockReturnValue({ success: true })
    retryPipeline.mockReturnValue({ success: true })
    skipPipelineReview.mockReturnValue({ success: true })
    getPipelineContext.mockReturnValue({
      state: 'paused',
      currentStage: 'director'
    })

    const pauseHandler = handlers.get(IPC.PIPELINE_PAUSE)
    const abortHandler = handlers.get(IPC.PIPELINE_ABORT)
    const resumeHandler = handlers.get(IPC.PIPELINE_RESUME)
    const retryHandler = handlers.get(IPC.PIPELINE_RETRY)
    const skipHandler = handlers.get(IPC.PIPELINE_SKIP)
    const stateHandler = handlers.get(IPC.PIPELINE_GET_STATE)

    expect(await pauseHandler?.({})).toEqual({ success: true })
    expect(await abortHandler?.({})).toEqual({ success: true })
    expect(await resumeHandler?.({})).toEqual({ success: true })
    expect(await retryHandler?.({}, 'art')).toEqual({ success: true })
    expect(await skipHandler?.({}, 'director')).toEqual({ success: true })
    expect(await stateHandler?.({})).toEqual({
      state: 'paused',
      currentStage: 'director'
    })

    expect(pausePipeline).toHaveBeenCalledWith({ id: 'engine' })
    expect(abortPipeline).toHaveBeenCalledWith({ id: 'engine' })
    expect(resumePipeline).toHaveBeenCalledWith({ id: 'engine' })
    expect(retryPipeline).toHaveBeenCalledWith({ id: 'engine' }, 'art')
    expect(skipPipelineReview).toHaveBeenCalledWith(
      { id: 'engine' },
      'director'
    )
    expect(getPipelineContext).toHaveBeenCalledWith({ id: 'engine' })
  })

  it('工作流动作入口会校验受信路径并调用 workflow runner', async () => {
    runWorkflowAction.mockResolvedValue({
      stage: 'script_review',
      success: true
    })

    const handler = handlers.get(IPC.WORKFLOW_RUN_SCRIPT_REVIEW)
    const payload = {
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    }

    const result = await handler?.({}, payload)

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(runWorkflowAction).toHaveBeenCalledWith(
      { id: 'runner' },
      'runScriptReview',
      { ...payload, projectPath: '/tmp/project' }
    )
    expect(result).toEqual({
      stage: 'script_review',
      success: true
    })
  })

  it('工作流动作入口在执行失败时会返回结构化错误', async () => {
    runWorkflowAction.mockRejectedValue(new Error('runner failed'))

    const handler = handlers.get(IPC.WORKFLOW_RUN_STORY_GENERATION)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      }
    )

    expect(result).toEqual({
      success: false,
      error: 'runner failed'
    })
  })
})
