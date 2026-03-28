import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import type { ReviewResult } from '@shared/types'

interface LatestScriptReviewCardProps {
  reviewResult?: ReviewResult | null
}

export default function LatestScriptReviewCard({ reviewResult }: LatestScriptReviewCardProps) {
  return (
    <div className="as-review-card card">
      <div className="as-section-head">
        <h3>最近一次剧本质检</h3>
        <span className={`as-review-badge ${reviewResult?.passed ? 'is-pass' : reviewResult ? 'is-fail' : 'is-idle'}`}>
          {reviewResult ? `${reviewResult.passed ? 'PASS' : 'FAIL'} · ${reviewResult.score}` : '暂无结果'}
        </span>
      </div>
      {reviewResult ? (
        <>
          <div className="as-review-feedback">
            <SimpleMarkdown content={reviewResult.feedback} />
          </div>
          {reviewResult.issues.length > 0 && (
            <div className="as-review-issues">
              {reviewResult.issues.map((issue, index) => (
                <div key={`${issue.severity}-${index}`} className={`as-review-issue is-${issue.severity}`}>
                  <strong>{issue.severity.toUpperCase()}</strong>
                  <span>{issue.description}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-secondary">当前还没有可展示的剧本质检结果。</div>
      )}
    </div>
  )
}
