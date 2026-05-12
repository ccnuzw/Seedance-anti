import { describe, expect, it, vi } from 'vitest'
import {
  buildBatchPipelineParams,
  resolveBatchExecutionEpisodes,
  isWorkflowBatchMode,
  isBatchRunSuccess,
  runBatchWorkflowMode,
  resolveBatchRunException,
  resolveBatchRunProgress
} from './batch-runner'

describe('batch-runner', () => {
  it('会根据批量模式构造 pipeline 参数', () => {
    const full = buildBatchPipelineParams(
      {
        projectId: 'p1',
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      'full'
    )

    const director = buildBatchPipelineParams(
      {
        projectId: 'p1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      'director'
    )

    expect(full.startStage).toBeUndefined()
    expect(full.singleStage).toBe(false)
    expect(director.startStage).toBe('director')
    expect(director.singleStage).toBe(true)
  })

  it('会识别 workflow 批量模式', () => {
    expect(isWorkflowBatchMode('preproduction')).toBe(true)
    expect(isWorkflowBatchMode('story_review')).toBe(true)
    expect(isWorkflowBatchMode('director')).toBe(false)
  })

  it('会按水位为自动模式选择执行目标', () => {
    expect(
      resolveBatchExecutionEpisodes({
        mode: 'smart_next',
        selectedEpisodes: [],
        allEpisodes: [1, 2, 3],
        waterline: {
          unusedEntries: 0,
          readyEpisodeNumbers: [],
          nextBatchNumber: 4,
          unprocessedChapterCount: 20,
          nextActionMode: 'breakdown'
        }
      })
    ).toEqual([4])

    expect(
      resolveBatchExecutionEpisodes({
        mode: 'script_until_empty',
        selectedEpisodes: [],
        allEpisodes: [1, 2, 3],
        waterline: {
          unusedEntries: 8,
          readyEpisodeNumbers: [2, 3],
          nextBatchNumber: 4,
          unprocessedChapterCount: 20,
          nextActionMode: 'script'
        }
      })
    ).toEqual([2, 3])
  })

  it('会区分全流程和单阶段的成功状态', () => {
    expect(
      isBatchRunSuccess({ success: true, state: 'episode_complete' }, 'full')
    ).toBe(true)
    expect(
      isBatchRunSuccess({ success: true, state: 'director_done' }, 'full')
    ).toBe(false)
    expect(
      isBatchRunSuccess({ success: true, state: 'director_done' }, 'director')
    ).toBe(true)
    expect(
      isBatchRunSuccess(
        { success: true, state: 'episode_complete' },
        'director'
      )
    ).toBe(false)
  })

  it('会为成功和失败结果生成任务展示文案', () => {
    expect(
      resolveBatchRunProgress({ success: true, state: 'art_done' }, 'art', 12)
    ).toEqual({
      status: 'done',
      progress: '完成 (12s)',
      elapsed: 12
    })

    expect(
      resolveBatchRunProgress(
        { success: true, state: 'paused' },
        'storyboard',
        7
      )
    ).toEqual({
      status: 'error',
      progress: '失败: paused',
      elapsed: 7
    })
  })

  it('workflow 批量结果会生成任务展示文案', () => {
    expect(
      resolveBatchRunProgress(
        {
          success: false,
          stage: 'script_review',
          message: '剧本审核未通过'
        },
        'preproduction',
        31
      )
    ).toEqual({
      status: 'error',
      progress: '剧本审核未通过 (31s)',
      elapsed: 31
    })
  })

  it('可执行单个 workflow 批量模式', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'story_review',
      {
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runStoryReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    })
  })

  it('preproduction 有剧情库存时会直接生成剧本', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(1)
    expect(deps.runScriptReview).toHaveBeenCalledTimes(1)
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
  })

  it('preproduction 缺少未用剧情点时会先补剧情库存', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '冲突不足' }
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptGeneration: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: '缺少当前集未用剧情点，请先完成剧情库存拆解'
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(2)
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '冲突不足' })
    )
    expect(deps.runStoryReview).toHaveBeenCalledTimes(2)
    expect(deps.runScriptReview).toHaveBeenCalledTimes(1)
  })

  it('preproduction 会按 maxRetries 多轮修复剧情拆解审核失败', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '冲突不足' }
        })
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '钩子不足' }
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptGeneration: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: '缺少当前集未用剧情点，请先完成剧情库存拆解'
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        maxRetries: 2
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runStoryGeneration).toHaveBeenCalledTimes(3)
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '冲突不足' })
    )
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ reviewFeedback: '钩子不足' })
    )
    expect(deps.runStoryReview).toHaveBeenCalledTimes(3)
  })

  it('preproduction 会在剧本审核失败后带反馈重写并复审', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '对白拖沓' }
        })
        .mockResolvedValueOnce({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '对白拖沓' })
    )
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
    expect(deps.runScriptReview).toHaveBeenCalledTimes(2)
  })

  it('preproduction 会按 maxRetries 多轮修复剧本审核失败', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '对白拖沓' }
        })
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '动作不足' }
        })
        .mockResolvedValueOnce({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        maxRetries: 2
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(3)
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '对白拖沓' })
    )
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ reviewFeedback: '动作不足' })
    )
    expect(deps.runScriptReview).toHaveBeenCalledTimes(3)
  })

  it('preproduction 遇到非库存错误时不会补剧情拆解', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({
        success: false,
        error: '连接失败'
      }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result).toMatchObject({
      success: false,
      stage: 'script',
      message: '连接失败'
    })
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
    expect(deps.runScriptReview).not.toHaveBeenCalled()
  })

  it('会把异常转换为统一文案', () => {
    expect(resolveBatchRunException(new Error('boom'))).toBe('boom')
    expect(resolveBatchRunException(null)).toBe('执行异常')
  })
})
