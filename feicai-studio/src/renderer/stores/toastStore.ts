import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  type: ToastType
  title?: string
  message: string
  duration: number
  createdAt: number
  exiting?: boolean
}

interface ToastOptions {
  title?: string
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, options?: number | ToastOptions) => void
  removeToast: (id: string) => void
  startExit: (id: string) => void
}

let _id = 0
const EXIT_ANIMATION_MS = 300

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (type, message, options) => {
    const id = String(++_id)
    const now = Date.now()

    let duration = 4000
    let title: string | undefined

    if (typeof options === 'number') {
      duration = options
    } else if (options) {
      duration = options.duration ?? 4000
      title = options.title
    }

    set((s) => ({
      toasts: [...s.toasts, { id, type, title, message, duration, createdAt: now }]
    }))

    if (duration > 0) {
      setTimeout(() => get().startExit(id), duration)
    }
  },

  startExit: (id) => {
    set((s) => ({
      toasts: s.toasts.map(t => t.id === id ? { ...t, exiting: true } : t)
    }))
    // 等待渐出动画完成后移除
    setTimeout(() => get().removeToast(id), EXIT_ANIMATION_MS)
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) }))
  }
}))
