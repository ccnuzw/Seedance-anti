import type { ReviewResult } from '@shared/types'
import {
  getExceptionMessage,
  getServiceErrorMessage
} from '@renderer/services/service-contracts'

interface WorkflowResultLike {
  success: boolean
  review?: ReviewResult
  error?: string
  message?: string
}

export interface WorkflowActionOutcome {
  status: 'success' | 'review_failed' | 'error'
  toastType: 'success' | 'warning' | 'error'
  toastMessage: string
  shouldSyncEpisode: boolean
  review?: ReviewResult
}

export interface ServiceActionOutcome<T> {
  status: 'success' | 'error'
  toastType: 'success' | 'info' | 'error'
  toastMessage: string
  result?: T
}

type WorkflowToast = (
  type: 'success' | 'info' | 'warning' | 'error',
  message: string
) => void

export function resolveWorkflowActionOutcome(
  result: WorkflowResultLike,
  options: {
    successMessage: string
    reviewFailureMessage: (review: ReviewResult) => string
    errorFallbackMessage: string
  }
): WorkflowActionOutcome {
  if (result.success) {
    return {
      status: 'success',
      toastType: 'success',
      toastMessage: options.successMessage,
      shouldSyncEpisode: true,
      review: result.review
    }
  }

  if (result.review) {
    return {
      status: 'review_failed',
      toastType: 'warning',
      toastMessage: options.reviewFailureMessage(result.review),
      shouldSyncEpisode: false,
      review: result.review
    }
  }

  return {
    status: 'error',
    toastType: 'error',
    toastMessage:
      result.error || result.message || options.errorFallbackMessage,
    shouldSyncEpisode: false
  }
}

export async function executeWorkflowAction<
  T extends WorkflowResultLike
>(options: {
  execute: () => Promise<T>
  successMessage: string
  reviewFailureMessage: (review: ReviewResult) => string
  errorFallbackMessage: string
  exceptionFallbackMessage?: string
  addToast: WorkflowToast
  onResult?: (result: T) => void | Promise<void>
  onReview?: (review: ReviewResult) => void | Promise<void>
  syncOnSuccess?: () => void | Promise<void>
  onSuccess?: (result: T) => void | Promise<void>
  onFinally?: () => void | Promise<void>
}): Promise<WorkflowActionOutcome> {
  try {
    const result = await options.execute()
    await options.onResult?.(result)

    const outcome = resolveWorkflowActionOutcome(result, {
      successMessage: options.successMessage,
      reviewFailureMessage: options.reviewFailureMessage,
      errorFallbackMessage: options.errorFallbackMessage
    })

    if (outcome.review) {
      await options.onReview?.(outcome.review)
    }
    if (outcome.shouldSyncEpisode && result.success) {
      await options.syncOnSuccess?.()
    }
    if (outcome.status === 'success') {
      await options.onSuccess?.(result)
    }

    options.addToast(outcome.toastType, outcome.toastMessage)
    return outcome
  } catch (error) {
    const message = getExceptionMessage(
      error,
      options.exceptionFallbackMessage || options.errorFallbackMessage
    )
    options.addToast('error', message)
    return {
      status: 'error',
      toastType: 'error',
      toastMessage: message,
      shouldSyncEpisode: false
    }
  } finally {
    await options.onFinally?.()
  }
}

export async function executeServiceAction<
  T extends { success?: boolean; error?: string; message?: string }
>(options: {
  execute: () => Promise<T>
  successMessage: string
  errorFallbackMessage: string
  exceptionFallbackMessage?: string
  addToast:
    | WorkflowToast
    | ((type: 'success' | 'info' | 'error', message: string) => void)
  onResult?: (result: T) => void | Promise<void>
  onSuccess?: (result: T) => void | Promise<void>
  onFinally?: () => void | Promise<void>
  successToastType?: 'success' | 'info'
}): Promise<ServiceActionOutcome<T>> {
  try {
    const result = await options.execute()
    await options.onResult?.(result)

    if (result.success === false) {
      const message = getServiceErrorMessage(
        result,
        options.errorFallbackMessage
      )
      options.addToast('error', message)
      return {
        status: 'error',
        toastType: 'error',
        toastMessage: message,
        result
      }
    }

    await options.onSuccess?.(result)
    const toastType = options.successToastType || 'success'
    options.addToast(toastType, options.successMessage)
    return {
      status: 'success',
      toastType,
      toastMessage: options.successMessage,
      result
    }
  } catch (error) {
    const message = getExceptionMessage(
      error,
      options.exceptionFallbackMessage || options.errorFallbackMessage
    )
    options.addToast('error', message)
    return {
      status: 'error',
      toastType: 'error',
      toastMessage: message
    }
  } finally {
    await options.onFinally?.()
  }
}
