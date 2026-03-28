import type { OperationFeedbackState } from '@renderer/hooks/useOperationFeedback'
import './OperationStatusBanner.css'

interface OperationStatusBannerProps {
  feedback: OperationFeedbackState | null
  onDismiss?: () => void
}

function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

export default function OperationStatusBanner({ feedback, onDismiss }: OperationStatusBannerProps) {
  if (!feedback) return null

  return (
    <div className={`operation-status-banner tone-${feedback.tone} ${feedback.busy ? 'is-busy' : ''}`}>
      <div className="operation-status-main">
        <div className="operation-status-title-row">
          <strong>{feedback.title}</strong>
          <span className="operation-status-time">更新于 {formatUpdatedAt(feedback.updatedAt)}</span>
        </div>
        <div className="operation-status-message">{feedback.message}</div>
      </div>
      {!feedback.busy && onDismiss && (
        <button className="operation-status-dismiss" onClick={onDismiss} aria-label="关闭操作反馈">
          ✕
        </button>
      )}
    </div>
  )
}
