import { describe, expect, it, vi } from 'vitest'
import {
  runStageGeneration,
  runStageReview
} from './state-machine-stage-runner'
import { DEFAULT_PIPELINE_SETTINGS } from '@shared/types'

describe('state-machine-stage-runner', () => {
  it('runStageGeneration 会切换状态、转发流式输出并记录导演产物路径', async () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onStream = vi.fn()
    const onDirectorOutputPath = vi.fn()
    const onStoryboardOutputPath = vi.fn()
    const onError = vi.fn()

    await runStageGeneration({
      stage: 'director',
      workflowEngine: {
        generateStage: vi.fn(async (_stage, _ctx, options) => {
          options?.onChunk?.('片段', 2)
          return {
            stage: 'director',
            outputPath: '/tmp/director.md',
            content: '导演分析',
            promptMetrics: { systemChars: 10, userChars: 20 }
          }
        })
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      onStateChange,
      onLog,
      onStream,
      shouldStop: () => false,
      onDirectorOutputPath,
      onStoryboardOutputPath,
      onError
    })

    expect(onStateChange).toHaveBeenCalledWith('director_analyzing')
    expect(onStream).toHaveBeenCalledWith({
      stage: 'director',
      chunk: '片段',
      totalLength: 2
    })
    expect(onDirectorOutputPath).toHaveBeenCalledWith('/tmp/director.md')
    expect(onStoryboardOutputPath).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('runStageReview 会切换到审核态并转发审核结果', async () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onReviewAppended = vi.fn()
    const onReviewResult = vi.fn()
    const onError = vi.fn()
    const review = {
      stage: 'director',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: new Date().toISOString()
    }

    const result = await runStageReview({
      stage: 'director',
      workflowEngine: {
        reviewStage: vi.fn().mockResolvedValue({
          stage: 'director',
          review
        })
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      scriptPath: '/tmp/project/script/ep01.md',
      projectConfig: null,
      onStateChange,
      onLog,
      onReviewAppended,
      onReviewResult,
      onError
    })

    expect(onStateChange).toHaveBeenCalledWith('director_reviewing')
    expect(onReviewAppended).toHaveBeenCalledWith(review)
    expect(onReviewResult).toHaveBeenCalledWith({
      stage: 'director',
      result: review
    })
    expect(result).toEqual(review)
    expect(onError).not.toHaveBeenCalled()
  })

  it('runStageGeneration 会在启用持久化时先标记阶段运行中，并在 storyboard 阶段记录分镜产物路径', async () => {
    const markStageRunning = vi.fn().mockResolvedValue(undefined)
    const onStoryboardOutputPath = vi.fn()

    await runStageGeneration({
      stage: 'storyboard',
      workflowEngine: {
        generateStage: vi.fn().mockResolvedValue({
          stage: 'storyboard',
          outputPath: '/tmp/storyboard.md',
          content: '分镜稿',
          promptMetrics: { systemChars: 11, userChars: 22 }
        })
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 9,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 9
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      statePersistence: {
        markStageRunning
      } as never,
      getStageOutputPath: vi.fn(() => '/tmp/storyboard.md'),
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onStream: vi.fn(),
      shouldStop: () => false,
      onDirectorOutputPath: vi.fn(),
      onStoryboardOutputPath,
      onError: vi.fn()
    })

    expect(markStageRunning).toHaveBeenCalledWith(9, 'storyboard', {
      outputPath: '/tmp/storyboard.md'
    })
    expect(onStoryboardOutputPath).toHaveBeenCalledWith('/tmp/storyboard.md')
  })

  it('runStageGeneration 在流式过程中被中断时会记录中断日志而不是报错', async () => {
    const onLog = vi.fn()
    const onError = vi.fn()

    await runStageGeneration({
      stage: 'art',
      workflowEngine: {
        generateStage: vi.fn(async (_stage, _ctx, options) => {
          options?.onChunk?.('片段', 2)
          return {
            stage: 'art',
            outputPath: '/tmp/art.md',
            content: '服化道',
            promptMetrics: { systemChars: 10, userChars: 20 }
          }
        })
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog,
      onStream: vi.fn(),
      shouldStop: () => true,
      onDirectorOutputPath: vi.fn(),
      onStoryboardOutputPath: vi.fn(),
      onError
    })

    expect(onLog).toHaveBeenCalledWith(
      'info',
      'aborted_during_gen',
      '⚓ LLM 生成已中断'
    )
    expect(onError).not.toHaveBeenCalled()
  })

  it('runStageGeneration 发生超时错误时会附带自动重试提示', async () => {
    const onError = vi.fn()

    await runStageGeneration({
      stage: 'director',
      workflowEngine: {
        generateStage: vi
          .fn()
          .mockRejectedValue(new Error('LLM 生成超时 (90s 无响应)'))
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onStream: vi.fn(),
      shouldStop: () => false,
      onDirectorOutputPath: vi.fn(),
      onStoryboardOutputPath: vi.fn(),
      onError
    })

    expect(onError).toHaveBeenCalledWith(
      '导演分析执行失败（将自动重试）',
      expect.any(Error)
    )
  })

  it('runStageGeneration 发生网络错误时会附带连接提示', async () => {
    const onError = vi.fn()

    await runStageGeneration({
      stage: 'art',
      workflowEngine: {
        generateStage: vi
          .fn()
          .mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onStream: vi.fn(),
      shouldStop: () => false,
      onDirectorOutputPath: vi.fn(),
      onStoryboardOutputPath: vi.fn(),
      onError
    })

    expect(onError).toHaveBeenCalledWith(
      '服化道设计执行失败（网络错误，请检查连接）',
      expect.any(Error)
    )
  })

  it('runStageGeneration 带审核反馈重试时会在 prompt 日志中标记', async () => {
    const onLog = vi.fn()

    await runStageGeneration({
      stage: 'director',
      workflowEngine: {
        generateStage: vi.fn().mockResolvedValue({
          stage: 'director',
          outputPath: '/tmp/director.md',
          content: '导演分析',
          promptMetrics: { systemChars: 9, userChars: 18 }
        })
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectContext: {
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      projectConfig: null,
      pipelineSettings: DEFAULT_PIPELINE_SETTINGS,
      reviewFeedback: '请补充情绪推进',
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog,
      onStream: vi.fn(),
      shouldStop: () => false,
      onDirectorOutputPath: vi.fn(),
      onStoryboardOutputPath: vi.fn(),
      onError: vi.fn()
    })

    expect(onLog).toHaveBeenCalledWith(
      'info',
      'prompt_assembled',
      'Prompt 已组装 (system: 9 chars, user: 18 chars) [带审核反馈]'
    )
  })

  it('runStageReview 失败时会返回 null 并调用错误处理', async () => {
    const onError = vi.fn()

    const result = await runStageReview({
      stage: 'storyboard',
      workflowEngine: {
        reviewStage: vi.fn().mockRejectedValue(new Error('review failed'))
      } as never,
      projectPath: '/tmp/project',
      episodeNum: 1,
      scriptPath: '/tmp/project/script/ep01.md',
      projectConfig: null,
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onReviewAppended: vi.fn(),
      onReviewResult: vi.fn(),
      onError
    })

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith('审核执行失败', expect.any(Error))
  })
})
