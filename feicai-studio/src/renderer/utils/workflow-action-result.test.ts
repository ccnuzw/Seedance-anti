import { describe, expect, it, vi } from 'vitest'
import type { ReviewResult } from '@shared/types'
import {
  executeServiceAction,
  executeWorkflowAction,
  resolveWorkflowActionOutcome
} from './workflow-action-result'

function createReview(partial: Partial<ReviewResult> = {}): ReviewResult {
  return {
    stage: 'storyboard_review',
    reviewType: 'business',
    result: 'FAIL',
    passed: false,
    score: 6,
    feedback: '需要修改',
    issues: [],
    createdAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

describe('workflow-action-result', () => {
  const options = {
    successMessage: '执行成功',
    reviewFailureMessage: (review: ReviewResult) =>
      `审核未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '执行失败'
  }

  it('成功时返回同步动作和成功提示', () => {
    const outcome = resolveWorkflowActionOutcome(
      {
        success: true,
        review: createReview({ passed: true, result: 'PASS', score: 9 })
      },
      options
    )

    expect(outcome.status).toBe('success')
    expect(outcome.toastType).toBe('success')
    expect(outcome.toastMessage).toBe('执行成功')
    expect(outcome.shouldSyncEpisode).toBe(true)
    expect(outcome.review?.score).toBe(9)
  })

  it('审核未通过时返回 warning，但不触发同步', () => {
    const outcome = resolveWorkflowActionOutcome(
      {
        success: false,
        review: createReview({ score: 5 })
      },
      options
    )

    expect(outcome.status).toBe('review_failed')
    expect(outcome.toastType).toBe('warning')
    expect(outcome.toastMessage).toBe('审核未通过，评分 5/10')
    expect(outcome.shouldSyncEpisode).toBe(false)
  })

  it('普通失败时优先使用服务端错误文案', () => {
    const outcome = resolveWorkflowActionOutcome(
      {
        success: false,
        error: '模型调用失败'
      },
      options
    )

    expect(outcome.status).toBe('error')
    expect(outcome.toastType).toBe('error')
    expect(outcome.toastMessage).toBe('模型调用失败')
    expect(outcome.shouldSyncEpisode).toBe(false)
  })

  it('执行 helper 会自动回填 review、同步并发送成功提示', async () => {
    const review = createReview({ passed: true, result: 'PASS', score: 9 })
    const addToast = vi.fn()
    const onReview = vi.fn()
    const syncOnSuccess = vi.fn()
    const onSuccess = vi.fn()

    const outcome = await executeWorkflowAction({
      execute: async () => ({ success: true, review }),
      successMessage: '执行成功',
      reviewFailureMessage: (nextReview) =>
        `审核未通过，评分 ${nextReview.score}/10`,
      errorFallbackMessage: '执行失败',
      addToast,
      onReview,
      syncOnSuccess,
      onSuccess
    })

    expect(outcome.status).toBe('success')
    expect(onReview).toHaveBeenCalledWith(review)
    expect(syncOnSuccess).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('success', '执行成功')
  })

  it('执行 helper 遇到异常时会统一返回 error 并发送异常提示', async () => {
    const addToast = vi.fn()

    const outcome = await executeWorkflowAction({
      execute: async () => {
        throw new Error('网络超时')
      },
      successMessage: '执行成功',
      reviewFailureMessage: (review) => `审核未通过，评分 ${review.score}/10`,
      errorFallbackMessage: '执行失败',
      addToast
    })

    expect(outcome.status).toBe('error')
    expect(outcome.toastMessage).toBe('网络超时')
    expect(addToast).toHaveBeenCalledWith('error', '网络超时')
  })

  it('普通 service helper 成功时会执行成功回调并发送 info 提示', async () => {
    const addToast = vi.fn()
    const onSuccess = vi.fn()

    const outcome = await executeServiceAction({
      execute: async () => ({ success: true, message: 'ok' }),
      successMessage: '已启动',
      errorFallbackMessage: '启动失败',
      addToast,
      onSuccess,
      successToastType: 'info'
    })

    expect(outcome.status).toBe('success')
    expect(onSuccess).toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith('info', '已启动')
  })

  it('普通 service helper 失败时优先使用服务端错误文案', async () => {
    const addToast = vi.fn()

    const outcome = await executeServiceAction({
      execute: async () => ({ success: false, error: '服务异常' }),
      successMessage: '已启动',
      errorFallbackMessage: '启动失败',
      addToast
    })

    expect(outcome.status).toBe('error')
    expect(outcome.toastMessage).toBe('服务异常')
    expect(addToast).toHaveBeenCalledWith('error', '服务异常')
  })
})
