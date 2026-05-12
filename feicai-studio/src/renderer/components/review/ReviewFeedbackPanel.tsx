import type { ReviewResult } from '@shared/types'
import './ReviewFeedbackPanel.css'

interface ReviewFeedbackPanelProps {
  title: string
  review: ReviewResult
  emptyHint?: string
  primaryActionLabel?: string
  onPrimaryAction?: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: '严重',
  major: '主要',
  minor: '轻微'
}

export default function ReviewFeedbackPanel(props: ReviewFeedbackPanelProps) {
  const {
    title,
    review,
    primaryActionLabel,
    onPrimaryAction,
    secondaryActionLabel,
    onSecondaryAction
  } = props

  const topIssues = review.issues.slice(0, 3)

  return (
    <div
      className={`review-feedback-panel ${review.passed ? 'is-pass' : 'is-fail'}`}
    >
      <div className="review-feedback-header">
        <div>
          <div className="review-feedback-title">{title}</div>
          <div className="review-feedback-meta">
            <span
              className={`review-feedback-result ${review.passed ? 'is-pass' : 'is-fail'}`}
            >
              {review.passed ? 'PASS' : 'FAIL'}
            </span>
            <span>{review.score}/10</span>
            <span>{new Date(review.createdAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>
        {(primaryActionLabel || secondaryActionLabel) && (
          <div className="review-feedback-actions">
            {secondaryActionLabel && onSecondaryAction && (
              <button className="btn btn-sm" onClick={onSecondaryAction}>
                {secondaryActionLabel}
              </button>
            )}
            {primaryActionLabel && onPrimaryAction && (
              <button
                className="btn btn-sm btn-primary"
                onClick={onPrimaryAction}
              >
                {primaryActionLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {topIssues.length > 0 ? (
        <div className="review-feedback-issues">
          {topIssues.map((issue, index) => (
            <div
              key={`${issue.description}-${index}`}
              className="review-feedback-issue"
            >
              <span
                className={`review-feedback-severity severity-${issue.severity}`}
              >
                {SEVERITY_LABELS[issue.severity] || issue.severity}
              </span>
              <span className="review-feedback-description">
                {issue.description}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="review-feedback-ok">
          最近一次审核未发现需修改的问题。
        </div>
      )}

      <details className="review-feedback-details">
        <summary>查看完整审核反馈</summary>
        <pre>{review.feedback}</pre>
      </details>
    </div>
  )
}
