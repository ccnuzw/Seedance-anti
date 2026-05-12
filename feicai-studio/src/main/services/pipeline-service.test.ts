import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getDefaultLLMConfig = vi.fn()
const findRegisteredProject = vi.fn()
const resolveProjectConfig = vi.fn()
const createProvider = vi.fn()
const readFileSync = vi.fn()

vi.mock('../db/llm-config-repository', () => ({
  getDefaultLLMConfig
}))

vi.mock('./project-service', () => ({
  findRegisteredProject,
  resolveProjectConfig
}))

vi.mock('../llm/provider-factory', () => ({
  createProvider
}))

vi.mock('fs', () => ({
  readFileSync
}))

describe('pipeline-service', async () => {
  const service = await import('./pipeline-service')
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('isPipelineBusy 会正确识别空引擎和终止态', () => {
    expect(service.isPipelineBusy(null)).toBe(false)

    const idleEngine = {
      getState: vi.fn(() => 'idle')
    }
    const pausedEngine = {
      getState: vi.fn(() => 'paused')
    }
    const errorEngine = {
      getState: vi.fn(() => 'error')
    }
    const completeEngine = {
      getState: vi.fn(() => 'episode_complete')
    }
    const runningEngine = {
      getState: vi.fn(() => 'director_analyzing')
    }

    expect(service.isPipelineBusy(idleEngine as never)).toBe(false)
    expect(service.isPipelineBusy(pausedEngine as never)).toBe(false)
    expect(service.isPipelineBusy(errorEngine as never)).toBe(false)
    expect(service.isPipelineBusy(completeEngine as never)).toBe(false)
    expect(service.isPipelineBusy(runningEngine as never)).toBe(true)
  })

  it('configurePipelineEngine 在缺少默认模型时抛错', () => {
    getDefaultLLMConfig.mockReturnValue(null)

    const engine = {
      setProvider: vi.fn(),
      setPipelineSettings: vi.fn()
    }

    expect(() =>
      service.configurePipelineEngine(engine as never, '/tmp/project')
    ).toThrow('请先在设置中配置 LLM 模型')
    expect(engine.setProvider).not.toHaveBeenCalled()
    expect(engine.setPipelineSettings).not.toHaveBeenCalled()
  })

  it('configureWorkflowRunner 在缺少默认模型时抛错', () => {
    getDefaultLLMConfig.mockReturnValue(null)

    const runner = {
      setProvider: vi.fn()
    }

    expect(() => service.configureWorkflowRunner(runner as never)).toThrow(
      '请先在设置中配置 LLM 模型'
    )
    expect(runner.setProvider).not.toHaveBeenCalled()
  })

  it('pausePipeline abortPipeline resumePipeline 会直接调用底层引擎', () => {
    const engine = {
      pause: vi.fn(),
      abort: vi.fn(),
      resume: vi.fn()
    }

    expect(service.pausePipeline(engine as never)).toEqual({ success: true })
    expect(service.abortPipeline(engine as never)).toEqual({ success: true })
    expect(service.resumePipeline(engine as never)).toEqual({ success: true })

    expect(engine.pause).toHaveBeenCalledTimes(1)
    expect(engine.abort).toHaveBeenCalledTimes(1)
    expect(engine.resume).toHaveBeenCalledTimes(1)
  })

  it('retryPipeline 会调用底层重试，并吞掉异步报错', async () => {
    const rejection = new Error('retry failed')
    const engine = {
      retry: vi.fn().mockRejectedValue(rejection)
    }

    const result = service.retryPipeline(engine as never, 'script')
    await Promise.resolve()

    expect(engine.retry).toHaveBeenCalledWith('script')
    expect(result).toEqual({ success: true })
    expect(consoleErrorSpy).toHaveBeenCalledWith(rejection)
  })

  it('skipPipelineReview 会在未传 stage 时回退到当前阶段', () => {
    const skipReview = vi.fn()
    const engine = {
      getContext: vi.fn(() => ({ currentStage: 'art' })),
      skipReview
    }

    const result = service.skipPipelineReview(engine as never)

    expect(skipReview).toHaveBeenCalledWith('art')
    expect(result).toEqual({ success: true })
  })

  it('runWorkflowAction 会先配置 runner 再执行目标动作', async () => {
    getDefaultLLMConfig.mockReturnValue({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    createProvider.mockReturnValue({ kind: 'provider' })
    resolveProjectConfig.mockReturnValue({ projectName: '项目 A' })

    const runner = {
      setProvider: vi.fn(),
      runScriptReview: vi.fn().mockResolvedValue({
        stage: 'script_review',
        success: true,
        review: { passed: true }
      })
    }

    const result = await service.runWorkflowAction(
      runner as never,
      'runScriptReview',
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        reviewFeedback: '需要加强开场冲突'
      }
    )

    expect(runner.setProvider).toHaveBeenCalledWith({ kind: 'provider' })
    expect(runner.runScriptReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectConfig: { projectName: '项目 A' },
      projectContext: {
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2,
        durationMin: 90,
        durationMax: 120,
        singlePromptMax: 10,
        scriptWordCountMin: 1500,
        scriptWordCountMax: 2000
      },
      reviewFeedback: '需要加强开场冲突'
    })
    expect(result).toEqual({
      stage: 'script_review',
      success: true,
      review: { passed: true }
    })
  })

  it('launchPipeline 在项目配置缺失且配置文件损坏时会回退默认设置', async () => {
    getDefaultLLMConfig.mockReturnValue({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    readFileSync.mockReturnValue('{broken-json')
    resolveProjectConfig.mockReturnValue(undefined)

    const engine = {
      setProvider: vi.fn(),
      setPipelineSettings: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      getContext: vi.fn(() => ({
        state: 'idle',
        currentStage: 'story'
      }))
    }

    const result = await service.launchPipeline(
      engine as never,
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 3,
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        startStage: 'script',
        singleStage: true
      },
      { waitForCompletion: false }
    )

    expect(engine.setPipelineSettings).toHaveBeenCalledWith({
      durationMin: 90,
      durationMax: 120,
      singlePromptMax: 10,
      scriptWordCountMin: 1500,
      scriptWordCountMax: 2000,
      llmTimeoutSec: 90,
      maxRetries: 3,
      passScore: 7
    })
    expect(engine.start).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectConfig: undefined,
      projectContext: {
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 3,
        durationMin: 90,
        durationMax: 120,
        singlePromptMax: 10,
        scriptWordCountMin: 1500,
        scriptWordCountMax: 2000
      },
      startStage: 'script',
      singleStage: true
    })
    expect(result).toEqual({ success: true, message: '流水线已启动' })
  })

  it('launchPipeline 会使用结构化项目配置并在异步模式返回启动成功', async () => {
    getDefaultLLMConfig.mockReturnValue({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    readFileSync.mockReturnValue(
      JSON.stringify({
        pipelineSettings: {
          durationMin: 3,
          durationMax: 5,
          singlePromptMax: 7,
          scriptWordCountMin: 1100,
          scriptWordCountMax: 1600
        }
      })
    )
    resolveProjectConfig.mockReturnValue({
      projectName: '项目 A',
      totalEpisodes: 10
    })

    const engine = {
      setProvider: vi.fn(),
      setPipelineSettings: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      getContext: vi.fn(() => ({
        state: 'director_done',
        currentStage: 'director'
      }))
    }

    const result = await service.launchPipeline(
      engine as never,
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      { waitForCompletion: false }
    )

    expect(engine.setProvider).toHaveBeenCalledWith({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    expect(engine.setPipelineSettings).toHaveBeenCalledWith({
      durationMin: 3,
      durationMax: 5,
      singlePromptMax: 7,
      scriptWordCountMin: 1100,
      scriptWordCountMax: 1600,
      llmTimeoutSec: 90,
      maxRetries: 3,
      passScore: 7
    })
    expect(engine.start).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectConfig: {
        projectName: '项目 A',
        totalEpisodes: 10
      },
      projectContext: {
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 2,
        totalEpisodes: 10,
        durationMin: 3,
        durationMax: 5,
        singlePromptMax: 7,
        scriptWordCountMin: 1100,
        scriptWordCountMax: 1600
      },
      startStage: undefined,
      singleStage: undefined
    })
    expect(result).toEqual({ success: true, message: '流水线已启动' })
  })

  it('launchPipeline 在等待完成模式下会返回引擎最终 state 和当前 stage，并透传单阶段参数', async () => {
    getDefaultLLMConfig.mockReturnValue({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    readFileSync.mockReturnValue(JSON.stringify({}))
    resolveProjectConfig.mockReturnValue({
      projectName: '项目 A',
      totalEpisodes: 10
    })

    const engine = {
      setProvider: vi.fn(),
      setPipelineSettings: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      getContext: vi.fn(() => ({
        state: 'art_done',
        currentStage: 'art'
      }))
    }

    const result = await service.launchPipeline(
      engine as never,
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 5,
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧',
        startStage: 'art',
        singleStage: true
      },
      { waitForCompletion: true }
    )

    expect(engine.start).toHaveBeenCalledWith(
      expect.objectContaining({
        startStage: 'art',
        singleStage: true
      })
    )
    expect(result).toEqual({
      success: true,
      state: 'art_done',
      stage: 'art'
    })
  })

  it('launchPipeline 在异步启动报错时会记录错误但仍返回启动成功', async () => {
    getDefaultLLMConfig.mockReturnValue({
      id: 'cfg-1',
      name: '默认模型',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      model: 'gpt-test',
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    })
    readFileSync.mockReturnValue(JSON.stringify({}))
    resolveProjectConfig.mockReturnValue(null)

    const engine = {
      setProvider: vi.fn(),
      setPipelineSettings: vi.fn(),
      start: vi.fn().mockRejectedValue(new Error('boom')),
      getContext: vi.fn()
    }

    const result = await service.launchPipeline(
      engine as never,
      {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 5,
        projectName: '项目 A',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      { waitForCompletion: false }
    )

    await Promise.resolve()

    expect(result).toEqual({ success: true, message: '流水线已启动' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Pipeline error:',
      expect.any(Error)
    )
  })

  it('buildWorkflowStepParams 会带上解析后的 projectConfig', () => {
    resolveProjectConfig.mockReturnValue({
      projectName: '项目 C',
      entryStage: 'script',
      pipelineSettings: {
        scriptWordCountMin: 1300,
        scriptWordCountMax: 1900
      }
    })
    readFileSync.mockReturnValue(
      JSON.stringify({
        pipelineSettings: {
          scriptWordCountMin: 1300,
          scriptWordCountMax: 1900
        }
      })
    )

    const result = service.buildWorkflowStepParams({
      projectId: 'project-3',
      projectPath: '/tmp/project-c',
      episodeNum: 6,
      projectName: '项目 C',
      visualStyle: '写实',
      targetMedium: '短剧'
    })

    expect(resolveProjectConfig).toHaveBeenCalledWith({
      projectId: 'project-3',
      projectPath: '/tmp/project-c'
    })
    expect(result).toEqual({
      projectPath: '/tmp/project-c',
      episodeNum: 6,
      projectConfig: {
        projectName: '项目 C',
        entryStage: 'script',
        pipelineSettings: {
          scriptWordCountMin: 1300,
          scriptWordCountMax: 1900
        }
      },
      projectContext: {
        projectName: '项目 C',
        visualStyle: '写实',
        targetMedium: '短剧',
        episodeNumber: 6,
        durationMin: 90,
        durationMax: 120,
        singlePromptMax: 10,
        scriptWordCountMin: 1300,
        scriptWordCountMax: 1900
      }
    })
  })
})
