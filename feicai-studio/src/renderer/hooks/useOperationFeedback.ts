import { useCallback, useState } from 'react'
import type { ToastType } from '@renderer/stores/toastStore'

export interface OperationFeedbackState {
  action?: string
  tone: ToastType
  title: string
  message: string
  busy: boolean
  updatedAt: number
}

interface PublishOptions {
  action?: string
  tone: ToastType
  title: string
  message: string
  busy?: boolean
  toast?: boolean
  duration?: number
}

export function useOperationFeedback(
  addToast: (type: ToastType, message: string, options?: number | { title?: string; duration?: number }) => void
) {
  const [feedback, setFeedback] = useState<OperationFeedbackState | null>(null)

  const publish = useCallback((options: PublishOptions) => {
    const nextState: OperationFeedbackState = {
      action: options.action,
      tone: options.tone,
      title: options.title,
      message: options.message,
      busy: !!options.busy,
      updatedAt: Date.now()
    }
    setFeedback(nextState)

    if (options.toast !== false) {
      addToast(options.tone, options.message, {
        title: options.title,
        duration: options.duration
      })
    }

    return nextState
  }, [addToast])

  const start = useCallback((action: string, title: string, message: string) => {
    return publish({
      action,
      tone: 'info',
      title,
      message,
      busy: true,
      toast: false
    })
  }, [publish])

  const succeed = useCallback((action: string, title: string, message: string, toast = true) => {
    return publish({
      action,
      tone: 'success',
      title,
      message,
      busy: false,
      toast
    })
  }, [publish])

  const warn = useCallback((action: string, title: string, message: string, toast = true) => {
    return publish({
      action,
      tone: 'warning',
      title,
      message,
      busy: false,
      toast
    })
  }, [publish])

  const fail = useCallback((action: string, title: string, message: string, toast = true) => {
    return publish({
      action,
      tone: 'error',
      title,
      message,
      busy: false,
      toast
    })
  }, [publish])

  const clear = useCallback(() => {
    setFeedback(null)
  }, [])

  return {
    feedback,
    activeAction: feedback?.busy ? feedback.action : null,
    publish,
    start,
    succeed,
    warn,
    fail,
    clear
  }
}
