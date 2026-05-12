import { describe, expect, it, vi } from 'vitest'
import { handleReviewCycleResult } from './state-machine-review-cycle'

describe('state-machine-review-cycle', () => {
  it('审核通过时会切换到完成态并返回 passed', () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onStageComplete = vi.fn()
    const updateEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    const markStageReviewResult = vi.fn().mockResolvedValue(undefined)

    const outcome = handleReviewCycleResult({
      stage: 'director',
      reviewResult: {
        stage: 'director',
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: '通过',
        issues: [],
        createdAt: new Date().toISOString()
      },
      episodeNum: 1,
      retryCount: 0,
      maxRetries: 2,
      statePersistence: {
        updateEpisodeStatus,
        markStageReviewResult
      } as never,
      getStageOutputPath: vi.fn(() => '/tmp/director.md'),
      getStageReviewPath: vi.fn(() => undefined),
      onStateChange,
      onLog,
      onStageComplete
    })

    expect(onStateChange).toHaveBeenCalledWith('director_done')
    expect(onStageComplete).toHaveBeenCalledTimes(1)
    expect(markStageReviewResult).toHaveBeenCalledTimes(1)
    expect(updateEpisodeStatus).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({
      passed: true,
      nextRetryCount: 0,
      nextReviewFeedback: undefined,
      exhausted: false
    })
  })

  it('审核失败但未耗尽重试时会返回下一次重试信息', () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onStageComplete = vi.fn()

    const outcome = handleReviewCycleResult({
      stage: 'art',
      reviewResult: {
        stage: 'art',
        reviewType: 'business',
        result: 'FAIL',
        passed: false,
        score: 5,
        feedback: '补充细节',
        issues: [],
        createdAt: new Date().toISOString()
      },
      episodeNum: 1,
      retryCount: 1,
      maxRetries: 3,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      getStageReviewPath: vi.fn(),
      onStateChange,
      onLog,
      onStageComplete
    })

    expect(onStateChange).not.toHaveBeenCalled()
    expect(onStageComplete).not.toHaveBeenCalled()
    expect(onLog).toHaveBeenCalledWith(
      'warn',
      'review_fail',
      expect.stringContaining('(得分: 5/10)')
    )
    expect(outcome).toEqual({
      passed: false,
      nextRetryCount: 2,
      nextReviewFeedback: '补充细节',
      exhausted: false
    })
  })

  it('超过最大重试次数时会返回 exhausted 结果', () => {
    const outcome = handleReviewCycleResult({
      stage: 'storyboard',
      reviewResult: {
        stage: 'storyboard_review',
        reviewType: 'business',
        result: 'FAIL',
        passed: false,
        score: 4,
        feedback: '镜头不连贯',
        issues: [],
        createdAt: new Date().toISOString()
      },
      episodeNum: 1,
      retryCount: 2,
      maxRetries: 2,
      statePersistence: null,
      getStageOutputPath: vi.fn(),
      getStageReviewPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onStageComplete: vi.fn()
    })

    expect(outcome.passed).toBe(false)
    expect(outcome.nextRetryCount).toBe(3)
    expect(outcome.exhausted).toBe(true)
    expect(outcome.exhaustedMessage).toContain(
      'storyboard 阶段审核失败超过最大重试次数'
    )
  })

  it('reviewResult 为空时会按 0 分进入重试且不回写审核结果', () => {
    const markStageReviewResult = vi.fn().mockResolvedValue(undefined)

    const outcome = handleReviewCycleResult({
      stage: 'director',
      reviewResult: null,
      episodeNum: 1,
      retryCount: 0,
      maxRetries: 2,
      statePersistence: {
        markStageReviewResult
      } as never,
      getStageOutputPath: vi.fn(),
      getStageReviewPath: vi.fn(),
      onStateChange: vi.fn(),
      onLog: vi.fn(),
      onStageComplete: vi.fn()
    })

    expect(markStageReviewResult).not.toHaveBeenCalled()
    expect(outcome).toEqual({
      passed: false,
      nextRetryCount: 1,
      nextReviewFeedback: undefined,
      exhausted: false
    })
  })
})
