import { describe, expect, it, vi } from 'vitest'
import type { Project, ReviewResult, ProjectPipelineState } from '@shared/types'
import {
  executeStoryboardReReviewAction,
  executeStoryboardReviewAction,
  executeRegenerateScriptAndReviewAction,
  executeRegenerateStoryAndReviewAction,
  executeScriptGenerationAction,
  executeScriptReviewAction,
  executeStoryGenerationAction,
  executeStoryReviewAction,
  loadReviewHistoryAction
} from './editor-workflow-actions'

function createProject(): Project {
  return {
    id: 'project-1',
    name: '项目',
    visualStyle: '现实',
    targetMedium: '短剧',
    projectPath: '/tmp/project',
    totalEpisodes: 12,
    config: {
      projectName: '项目',
      totalEpisodes: 12,
      visualStyle: '现实',
      targetMedium: '短剧',
      createdAt: '2026-05-07T00:00:00.000Z'
    },
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z'
  }
}

function createReview(partial: Partial<ReviewResult> = {}): ReviewResult {
  return {
    stage: 'storyboard_review',
    reviewType: 'business',
    result: 'PASS',
    passed: true,
    score: 8,
    feedback: '通过',
    issues: [],
    createdAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

describe('editor-workflow-actions', () => {
  it('分镜审核通过时会写入反馈、同步单集并提示成功', async () => {
    const runStoryboardReview = vi.fn().mockResolvedValue({
      success: true,
      review: createReview({ score: 9 })
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()

    await executeStoryboardReviewAction(createProject(), 1, {
      runStoryboardReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast
    })

    expect(runStoryboardReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 1,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    })
    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      1,
      expect.objectContaining({ score: 9 })
    )
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(1)
    expect(addToast).toHaveBeenCalledWith('success', 'EP01 分镜审核已通过')
  })

  it('分镜审核未通过时只写入反馈并提示 warning', async () => {
    const runStoryboardReview = vi.fn().mockResolvedValue({
      success: false,
      review: createReview({
        result: 'FAIL',
        passed: false,
        score: 5
      })
    })
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()

    await executeStoryboardReviewAction(createProject(), 1, {
      runStoryboardReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast
    })

    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      1,
      expect.objectContaining({ score: 5 })
    )
    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith(
      'warning',
      '分镜审核未通过，评分 5/10'
    )
  })

  it('分镜审核普通失败时提示 error', async () => {
    const runStoryboardReview = vi.fn().mockResolvedValue({
      success: false,
      error: '审核服务异常'
    })
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()

    await executeStoryboardReviewAction(createProject(), 1, {
      runStoryboardReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast
    })

    expect(setReviewFeedback).not.toHaveBeenCalled()
    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('error', '审核服务异常')
  })

  it('刷新审核历史成功时按需提示成功', async () => {
    const historicalState: ProjectPipelineState = {
      projectId: 'project-1',
      updatedAt: '2026-05-08T00:00:00.000Z',
      episodes: {}
    }
    const getProjectPipelineState = vi.fn().mockResolvedValue(historicalState)
    const addToast = vi.fn()

    const result = await loadReviewHistoryAction('/tmp/project', true, {
      getProjectPipelineState,
      addToast
    })

    expect(result).toEqual(historicalState)
    expect(getProjectPipelineState).toHaveBeenCalledWith('/tmp/project')
    expect(addToast).toHaveBeenCalledWith('success', '审核记录已刷新')
  })

  it('刷新审核历史失败时返回 null 并提示错误', async () => {
    const getProjectPipelineState = vi
      .fn()
      .mockRejectedValue(new Error('load failed'))
    const addToast = vi.fn()

    const result = await loadReviewHistoryAction('/tmp/project', true, {
      getProjectPipelineState,
      addToast
    })

    expect(result).toBeNull()
    expect(addToast).toHaveBeenCalledWith('error', 'load failed')
  })

  it('剧本审核通过时会同步状态、写入反馈并跳转流程页', async () => {
    const runScriptReview = vi.fn().mockResolvedValue({
      success: true,
      review: createReview({
        stage: 'script_review',
        score: 9
      })
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeScriptReviewAction(createProject(), 2, {
      runScriptReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast,
      navigate
    })

    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      2,
      expect.objectContaining({ stage: 'script_review', score: 9 })
    )
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(2)
    expect(addToast).toHaveBeenCalledWith('success', 'EP02 剧本审核已通过')
    expect(navigate).toHaveBeenCalledWith('/project/project-1/pipeline?ep=2')
  })

  it('剧本审核未通过时只写入反馈并提示 warning，不跳转', async () => {
    const runScriptReview = vi.fn().mockResolvedValue({
      success: false,
      review: createReview({
        stage: 'script_review',
        result: 'FAIL',
        passed: false,
        score: 4
      })
    })
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeScriptReviewAction(createProject(), 2, {
      runScriptReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast,
      navigate
    })

    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      2,
      expect.objectContaining({ stage: 'script_review', score: 4 })
    )
    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith(
      'warning',
      '剧本审核未通过，评分 4/10'
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it('剧情审核通过时会写入反馈、同步单集并提示成功', async () => {
    const runStoryReview = vi.fn().mockResolvedValue({
      success: true,
      review: createReview({
        stage: 'story_review',
        score: 8
      })
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()

    await executeStoryReviewAction(createProject(), 2, {
      runStoryReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast
    })

    expect(runStoryReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    })
    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      2,
      expect.objectContaining({ stage: 'story_review', score: 8 })
    )
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(2)
    expect(addToast).toHaveBeenCalledWith(
      'success',
      'EP02 剧情拆解审核已通过'
    )
  })

  it('剧情审核未通过时只写入反馈并提示 warning', async () => {
    const runStoryReview = vi.fn().mockResolvedValue({
      success: false,
      review: createReview({
        stage: 'story_review',
        result: 'FAIL',
        passed: false,
        score: 5
      })
    })
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()

    await executeStoryReviewAction(createProject(), 2, {
      runStoryReview,
      syncSingleEpisodeStatus,
      setReviewFeedback,
      addToast
    })

    expect(setReviewFeedback).toHaveBeenCalledWith(
      '/tmp/project',
      2,
      expect.objectContaining({ stage: 'story_review', score: 5 })
    )
    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith(
      'warning',
      '剧情拆解审核未通过，评分 5/10'
    )
  })

  it('剧情拆解成功时会同步状态、提示成功并跳转剧情页', async () => {
    const runStoryGeneration = vi.fn().mockResolvedValue({
      success: true,
      outputPath: '/tmp/project/story/ep01.md'
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeStoryGenerationAction(createProject(), 3, {
      runStoryGeneration,
      syncSingleEpisodeStatus,
      addToast,
      navigate
    })

    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(3)
    expect(addToast).toHaveBeenCalledWith('success', 'EP03 剧情拆解已生成')
    expect(navigate).toHaveBeenCalledWith('/project/project-1/story?ep=3')
  })

  it('剧情拆解可携带审核反馈重新生成', async () => {
    const runStoryGeneration = vi.fn().mockResolvedValue({
      success: true,
      outputPath: '/tmp/project/story/ep03.md'
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeStoryGenerationAction(
      createProject(),
      3,
      {
        runStoryGeneration,
        syncSingleEpisodeStatus,
        addToast,
        navigate
      },
      { reviewFeedback: '冲突不足，结尾钩子弱' }
    )

    expect(runStoryGeneration).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      reviewFeedback: '冲突不足，结尾钩子弱'
    })
  })

  it('剧情拆解重写成功后会自动复审', async () => {
    const runStoryGeneration = vi.fn().mockResolvedValue({
      success: true,
      outputPath: '/tmp/project/story/ep03.md'
    })
    const runStoryReview = vi.fn().mockResolvedValue({
      success: true,
      review: createReview({ stage: 'story_review', score: 8 })
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()
    const reloadDocument = vi.fn().mockResolvedValue(undefined)

    const result = await executeRegenerateStoryAndReviewAction(
      createProject(),
      3,
      createReview({
        stage: 'story_review',
        feedback: '冲突不足，结尾钩子弱'
      }),
      {
        runStoryGeneration,
        runStoryReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast,
        navigate,
        reloadDocument
      }
    )

    expect(runStoryGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewFeedback: '冲突不足，结尾钩子弱'
      })
    )
    expect(reloadDocument).toHaveBeenCalledWith(3)
    expect(runStoryReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    })
    expect(result.generation.success).toBe(true)
    expect(result.review?.success).toBe(true)
  })

  it('剧情拆解重写失败时不会复审', async () => {
    const runStoryGeneration = vi.fn().mockResolvedValue({
      success: false,
      error: '生成失败'
    })
    const runStoryReview = vi.fn()
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()
    const reloadDocument = vi.fn()

    const result = await executeRegenerateStoryAndReviewAction(
      createProject(),
      3,
      createReview({ stage: 'story_review', feedback: '冲突不足' }),
      {
        runStoryGeneration,
        runStoryReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast,
        navigate,
        reloadDocument
      }
    )

    expect(result.generation.success).toBe(false)
    expect(runStoryReview).not.toHaveBeenCalled()
    expect(reloadDocument).not.toHaveBeenCalled()
  })

  it('剧情拆解失败时提示 error 且不跳转', async () => {
    const runStoryGeneration = vi.fn().mockResolvedValue({
      success: false,
      error: '生成失败'
    })
    const syncSingleEpisodeStatus = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeStoryGenerationAction(createProject(), 3, {
      runStoryGeneration,
      syncSingleEpisodeStatus,
      addToast,
      navigate
    })

    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('error', '生成失败')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('剧本生成可携带审核反馈重新生成', async () => {
    const runScriptGeneration = vi.fn().mockResolvedValue({
      success: true,
      outputPath: '/tmp/project/script/ep02.md'
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const addToast = vi.fn()
    const navigate = vi.fn()

    await executeScriptGenerationAction(
      createProject(),
      2,
      {
        runScriptGeneration,
        syncSingleEpisodeStatus,
        addToast,
        navigate
      },
      { reviewFeedback: '中段对白拖沓，结尾钩子不足' }
    )

    expect(runScriptGeneration).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      reviewFeedback: '中段对白拖沓，结尾钩子不足'
    })
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(2)
    expect(navigate).toHaveBeenCalledWith('/project/project-1/script?ep=2')
  })

  it('剧本重写成功后会自动复审', async () => {
    const runScriptGeneration = vi.fn().mockResolvedValue({
      success: true,
      outputPath: '/tmp/project/script/ep02.md'
    })
    const runScriptReview = vi.fn().mockResolvedValue({
      success: true,
      review: createReview({ stage: 'script_review', score: 9 })
    })
    const syncSingleEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()
    const reloadDocument = vi.fn().mockResolvedValue(undefined)

    const result = await executeRegenerateScriptAndReviewAction(
      createProject(),
      2,
      createReview({
        stage: 'script_review',
        feedback: '中段对白拖沓，结尾钩子不足'
      }),
      {
        runScriptGeneration,
        runScriptReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast,
        navigate,
        reloadDocument
      }
    )

    expect(runScriptGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewFeedback: '中段对白拖沓，结尾钩子不足'
      })
    )
    expect(reloadDocument).toHaveBeenCalledWith(2)
    expect(runScriptReview).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    })
    expect(result.generation.success).toBe(true)
    expect(result.review?.success).toBe(true)
  })

  it('剧本重写失败时不会复审', async () => {
    const runScriptGeneration = vi.fn().mockResolvedValue({
      success: false,
      error: '生成失败'
    })
    const runScriptReview = vi.fn()
    const syncSingleEpisodeStatus = vi.fn()
    const setReviewFeedback = vi.fn()
    const addToast = vi.fn()
    const navigate = vi.fn()
    const reloadDocument = vi.fn()

    const result = await executeRegenerateScriptAndReviewAction(
      createProject(),
      2,
      createReview({ stage: 'script_review', feedback: '中段拖沓' }),
      {
        runScriptGeneration,
        runScriptReview,
        syncSingleEpisodeStatus,
        setReviewFeedback,
        addToast,
        navigate,
        reloadDocument
      }
    )

    expect(result.generation.success).toBe(false)
    expect(runScriptReview).not.toHaveBeenCalled()
    expect(reloadDocument).not.toHaveBeenCalled()
  })

  it('分镜重新审核启动成功时提示 info', async () => {
    const startPipeline = vi.fn().mockResolvedValue({
      success: true,
      message: '流水线已启动'
    })
    const addToast = vi.fn()

    await executeStoryboardReReviewAction(createProject(), 4, {
      startPipeline,
      addToast
    })

    expect(startPipeline).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 4,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      startStage: 'storyboard',
      singleStage: true
    })
    expect(addToast).toHaveBeenCalledWith('info', '已启动分镜重新审核')
  })
})
