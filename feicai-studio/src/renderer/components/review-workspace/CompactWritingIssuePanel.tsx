import type { QAMode } from '@shared/types'
import EmptyState from '@renderer/components/layout/EmptyState'
import SimpleMarkdown from '@renderer/components/SimpleMarkdown'
import type { EpisodeQualityRow, ReviewEntry } from '@renderer/hooks/useReviewWorkspace'
import {
  buildReviewKey,
  formatDateTime,
  formatStage,
  getEpisodeStatusLabel,
  SEVERITY_MAP
} from '@renderer/components/review-workspace/reviewWorkspaceView'
import type { ReviewResult } from '@shared/types'

interface CompactWritingIssuePanelProps {
  qaMode: QAMode
  scriptAutoRepairRounds: number
  scriptPassScore: number
  selectedEp: number | 'all'
  loading: boolean
  artifactLoading: boolean
  isRunning: boolean
  reviewFailedData: {
    stage: string
    retryCount: number
  } | null
  blockerRows: EpisodeQualityRow[]
  avgScore: number
  totalIssues: number
  focusedRow: EpisodeQualityRow | null
  recentCompactReviews: ReviewEntry[]
  expandedReview: string | null
  adaptBlockingReview?: ReviewResult
  adaptBlockingHint: string
  onRefreshHistory: () => void
  onRefreshArtifacts: () => void
  onOpenFullPage: () => void
  onOpenEpisodeScript: (episodeNum: number) => void
  onOpenStageWorkspace: (stage: string, episodeNum?: number | null) => void
  onToggleReview: (reviewKey: string) => void
}

export default function CompactWritingIssuePanel({
  qaMode,
  scriptAutoRepairRounds,
  scriptPassScore,
  selectedEp,
  loading,
  artifactLoading,
  isRunning,
  reviewFailedData,
  blockerRows,
  avgScore,
  totalIssues,
  focusedRow,
  recentCompactReviews,
  expandedReview,
  adaptBlockingReview,
  adaptBlockingHint,
  onRefreshHistory,
  onRefreshArtifacts,
  onOpenFullPage,
  onOpenEpisodeScript,
  onOpenStageWorkspace,
  onToggleReview
}: CompactWritingIssuePanelProps) {
  const pendingCount = (reviewFailedData ? 1 : 0) + blockerRows.length
  const panelTone = qaMode === 'strict' ? 'warning' : qaMode === 'report_only' ? 'info' : 'default'
  const panelStateLabel = qaMode === 'strict' ? '严格门禁' : qaMode === 'report_only' ? '报告优先' : '宽松推进'
  const panelHint = qaMode === 'strict'
    ? '当前模式会优先强调阻塞项，建议先清问题再继续扩张新集数。'
    : qaMode === 'report_only'
      ? '当前模式把质检结果作为参考信息，适合边写边看，后续再集中回收问题。'
      : '当前模式允许边推进边修正，但仍建议优先处理严重问题。'
  const focusSummary = focusedRow
    ? focusedRow.lastReview
      ? `最近一次 ${formatStage(focusedRow.lastReview.stage)} 审核${focusedRow.lastReview.passed ? '通过' : '未通过'}，得分 ${focusedRow.lastReview.score}。`
      : focusedRow.hasScript
        ? '已有剧本，但还没有审核记录。'
        : '当前集还没有剧本文件。'
    : null

  return (
    <div className="review-page review-page--compact">
      <div className={`card review-status-card tone-${panelTone}`}>
        <div className="review-section-head">
          <h3>写作问题面板</h3>
          <div className="review-compact-head-badges">
            <span className={`review-pill ${reviewFailedData ? 'is-danger' : isRunning ? 'is-warning' : 'is-success'}`}>
              {reviewFailedData ? '待处理' : isRunning ? '运行中' : '稳定'}
            </span>
            <span className={`review-pill tone-${panelTone}`}>{panelStateLabel}</span>
          </div>
        </div>
        <p className="review-compact-policy-hint text-secondary">{panelHint}</p>
        <div className="review-status-list">
          <div className="review-status-row">
            <span className="text-secondary">当前集</span>
            <strong>{selectedEp === 'all' ? '全部集数' : `EP${String(selectedEp).padStart(3, '0')}`}</strong>
          </div>
          <div className="review-status-row">
            <span className="text-secondary">待处理阻塞</span>
            <strong className={pendingCount > 0 ? 'text-error' : 'text-success'}>{pendingCount}</strong>
          </div>
          <div className="review-status-row">
            <span className="text-secondary">当前集平均分</span>
            <strong className={avgScore >= 8 ? 'text-success' : avgScore >= 6 ? 'text-warning' : 'text-error'}>
              {avgScore || '—'}
            </strong>
          </div>
          <div className="review-status-row">
            <span className="text-secondary">当前集问题数</span>
            <strong>{totalIssues}</strong>
          </div>
        </div>
        <div className="review-compact-policy-chips">
          <span className="review-pill">通过线 {scriptPassScore} 分</span>
          <span className="review-pill">自动修订 {scriptAutoRepairRounds} 轮</span>
          <span className="review-pill">{qaMode === 'report_only' ? '问题供参考' : '问题会影响推进'}</span>
        </div>
        {focusedRow && (
          <div className={`review-compact-focus ${focusedRow.failCount > 0 || focusedRow.criticalCount > 0 ? 'has-problem' : focusedRow.hasScript ? 'is-ready' : 'is-empty'}`}>
            <div className="review-compact-focus-head">
              <strong>EP{String(focusedRow.episodeNum).padStart(3, '0')}</strong>
              <span className="review-quality-status">{getEpisodeStatusLabel(focusedRow.status)}</span>
            </div>
            <div className="review-compact-focus-badges">
              <span className={`review-pill ${focusedRow.hasScript ? 'is-success' : 'is-warning'}`}>
                {focusedRow.hasScript ? '剧本已就绪' : '缺剧本'}
              </span>
              <span className="review-pill">审核 {focusedRow.reviewCount}</span>
              <span className={`review-pill ${focusedRow.criticalCount > 0 ? 'is-danger' : ''}`}>严重 {focusedRow.criticalCount}</span>
            </div>
            <p className="text-secondary">{focusSummary}</p>
            <div className="review-compact-focus-actions">
              <button className="btn btn-sm" onClick={() => onOpenEpisodeScript(focusedRow.episodeNum)}>
                打开当前集
              </button>
            </div>
          </div>
        )}
        <div className="review-compact-actions">
          <button className="btn btn-sm" onClick={onRefreshHistory} disabled={loading}>
            {loading ? '刷新中...' : '刷新审核'}
          </button>
          <button className="btn btn-sm" onClick={onRefreshArtifacts} disabled={artifactLoading}>
            {artifactLoading ? '刷新中...' : '刷新版本'}
          </button>
          <button className="btn btn-sm" onClick={onOpenFullPage}>
            完整审核页
          </button>
        </div>
      </div>

      <div className="card review-inbox">
        <div className="review-section-head">
          <h3>待处理问题</h3>
          <span className="text-secondary text-xs">
            {qaMode === 'strict'
              ? '按阻塞优先级处理。'
              : qaMode === 'report_only'
                ? '作为当前写作参考。'
                : '跟着当前写作集数回看。'}
          </span>
        </div>
        <div className="review-inbox-list">
          {reviewFailedData && adaptBlockingReview && (
            <div className="review-inbox-item is-blocking">
              <div className="review-inbox-main">
                <div className="review-inbox-top">
                  <span className="review-pill is-danger">编剧阻塞</span>
                  <span className="review-pill">{formatStage(reviewFailedData.stage)}</span>
                  <span className="review-pill">重试 {reviewFailedData.retryCount}</span>
                </div>
                <strong>当前存在待修订失败项</strong>
                <p className="text-secondary">
                  {qaMode === 'report_only'
                    ? `当前仍有失败项可供回看。${adaptBlockingHint}`
                    : adaptBlockingHint}
                </p>
              </div>
              <div className="review-inbox-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => onOpenStageWorkspace(reviewFailedData.stage, selectedEp === 'all' ? undefined : selectedEp)}
                >
                  去处理
                </button>
              </div>
            </div>
          )}

          {blockerRows.slice(0, 4).map((row) => (
            <div key={row.episodeNum} className={`review-inbox-item ${row.failCount > 0 || row.criticalCount > 0 ? 'is-warning' : ''}`}>
              <div className="review-inbox-main">
                <div className="review-inbox-top">
                  <span className="review-pill">EP{String(row.episodeNum).padStart(3, '0')}</span>
                  <span className={`review-pill ${row.hasScript ? 'is-success' : 'is-warning'}`}>
                    {row.hasScript ? '已成稿' : '缺剧本'}
                  </span>
                </div>
                <strong>
                  {!row.hasScript
                    ? '当前还没有剧本文件'
                    : row.lastReview && !row.lastReview.passed
                      ? `${qaMode === 'report_only' ? '最近一次' : '优先处理'} ${formatStage(row.lastReview.stage)} 审核${qaMode === 'report_only' ? '结果' : '未通过'}`
                      : qaMode === 'report_only' ? '存在可回看问题' : '存在待确认问题'}
                </strong>
                <p className="text-secondary">
                  {!row.hasScript
                    ? '先把当前集写出来，后续质检和送制作才有依据。'
                    : qaMode === 'report_only'
                      ? `共记录 ${row.failCount} 次失败 · 严重问题 ${row.criticalCount} 个，可作为回看清单。`
                      : `失败 ${row.failCount} 次 · 严重问题 ${row.criticalCount} 个`}
                </p>
              </div>
              <div className="review-inbox-actions">
                <button className="btn btn-sm btn-primary" onClick={() => onOpenEpisodeScript(row.episodeNum)}>
                  打开该集
                </button>
              </div>
            </div>
          ))}

          {!reviewFailedData && blockerRows.length === 0 && (
            <div className="review-empty-card">
              <strong>{qaMode === 'report_only' ? '当前没有需要重点回看的问题' : '当前没有明显阻塞'}</strong>
              <p className="text-secondary">
                {qaMode === 'report_only'
                  ? '可以继续推进剧本写作，后续再集中回看最近审核记录。'
                  : '可以继续推进剧本写作，重点关注当前集最新审核结果。'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="card review-timeline">
        <div className="review-section-head">
          <h3>最近审核</h3>
          <span className="text-secondary text-xs">
            {selectedEp === 'all' ? '最近 6 条' : `EP${String(selectedEp).padStart(3, '0')} 最近记录`}
          </span>
        </div>
        {recentCompactReviews.length === 0 ? (
          <div className="review-empty-card">
            <strong>暂无审核记录</strong>
            <p className="text-secondary">完成生成或修订后，新的审核结果会出现在这里。</p>
          </div>
        ) : (
          <div className="review-record-list">
            {recentCompactReviews.map((entry) => {
              const reviewKey = buildReviewKey(entry.episodeNum, entry.review)
              const isExpanded = expandedReview === reviewKey
              return (
                <div key={entry.id} className={`review-record-card ${entry.review.passed ? 'is-pass' : 'is-fail'}`}>
                  <button className="review-record-head" onClick={() => onToggleReview(reviewKey)}>
                    <div className="review-record-main">
                      <span className={`review-pill ${entry.review.passed ? 'is-success' : 'is-danger'}`}>
                        {entry.review.passed ? 'PASS' : 'FAIL'}
                      </span>
                      {entry.episodeNum && <span className="review-pill">EP{String(entry.episodeNum).padStart(3, '0')}</span>}
                      <span className="review-pill">{formatStage(entry.review.stage)}</span>
                      <strong>{entry.review.score} 分</strong>
                    </div>
                    <div className="review-record-side text-secondary">
                      <span>{formatDateTime(entry.review.createdAt)}</span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="review-record-body">
                      {entry.review.issues.length > 0 && (
                        <div className="review-issues">
                          {entry.review.issues.slice(0, 3).map((issue, index) => {
                            const severity = SEVERITY_MAP[issue.severity] || SEVERITY_MAP.minor
                            return (
                              <div key={`${reviewKey}-${index}`} className="review-issue-row">
                                <span className={`review-issue-severity ${severity.cls}`}>{severity.label}</span>
                                <div className="review-issue-copy">
                                  <strong>{issue.description}</strong>
                                  {issue.suggestion && <p className="text-secondary">建议：{issue.suggestion}</p>}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <div className="review-feedback-panel">
                        <SimpleMarkdown content={entry.review.feedback} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
