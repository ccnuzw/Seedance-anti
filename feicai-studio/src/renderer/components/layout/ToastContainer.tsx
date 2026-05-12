import { useToastStore } from '@renderer/stores/toastStore'
import './ToastContainer.css'

const TOAST_ICONS: Record<string, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️'
}

export default function ToastContainer() {
  const { toasts, startExit } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type} ${toast.exiting ? 'toast-exit' : ''}`}
          onClick={() => startExit(toast.id)}
        >
          <span className="toast-icon">{TOAST_ICONS[toast.type]}</span>
          <div className="toast-body">
            {toast.title && <div className="toast-title">{toast.title}</div>}
            <span className="toast-message">{toast.message}</span>
          </div>
          <button
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation()
              startExit(toast.id)
            }}
            aria-label="关闭"
          >
            ✕
          </button>
          {toast.duration > 0 && (
            <div
              className="toast-progress"
              style={{ animationDuration: `${toast.duration}ms` }}
            />
          )}
        </div>
      ))}
    </div>
  )
}
