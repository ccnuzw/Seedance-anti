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
import type { ArtifactRecord, ReviewResult } from '@shared/types'

interface ReviewFullWorkspaceProps {
  embedded: boolean
  title: string
  subtitle: string
  selectedEp: number | 'all'
  epList: number[]
  qualityRows: EpisodeQualityRow[]
  visibleQualityRows: EpisodeQualityRow[]
  selectedReviewEntries: ReviewEntry[]
  visibleArtifactGroups: ArtifactRecord[][]
  artifactGroupEntries: ArtifactRecord[][]
  reviewFailedData: {
    stage: string
    retryCount: number
    batchNum?: number
  } | null
  adaptState: string
  isRunning: boolean
  loading: boolean
  artifactLoading: boolean
  rollingBackArtifactId: string | null
  blockerRows: EpisodeQualityRow[]
  totalReviews: number
  passCount: number
  failCount: number
  totalIssues: number
  criticalCount: number
  avgScore: number
  scriptReadyCount: number
  episodePassCount: number
  expandedReview: string | null
  adaptBlockingReview?: ReviewResult
  adaptBlockingHint: string
  onRefreshHistory: () => void
  onRefreshArtifacts: () => void
  onSelectEpisode: (episode: number | 'all') => void
  onOpenEpisodeScript: (episodeNum: number) => void
  onOpenEpisodePipeline: (episodeNum: number) => void
  onOpenStageWorkspace: (stage: string, episodeNum?: number | null) => void
  onToggleReview: (reviewKey: string) => void
  onRollbackArtifact: (artifactId: string) => void
}

export default function ReviewFullWorkspace({
  embedded,
  title,
  subtitle,
  selectedEp,
  epList,
  qualityRows,
  visibleQualityRows,
  selectedReviewEntries,
  visibleArtifactGroups,
  artifactGroupEntries,
  reviewFailedData,
  adaptState,
  isRunning,
  loading,
  artifactLoading,
  rollingBackArtifactId,
  blockerRows,
  totalReviews,
  passCount,
  failCount,
  totalIssues,
  criticalCount,
  avgScore,
  scriptReadyCount,
  episodePassCount,
  expandedReview,
  adaptBlockingReview,
  adaptBlockingHint,
  onRefreshHistory,
  onRefreshArtifacts,
  onSelectEpisode,
  onOpenEpisodeScript,
  onOpenEpisodePipeline,
  onOpenStageWorkspace,
  onToggleReview,
  onRollbackArtifact
}: ReviewFullWorkspaceProps) {
  return (
    <div className="review-page">
      {!embedded && (
        <div className="review-header">
          <div className="review-header-copy">
            <h1>{title}</h1>
            <p className="text-secondary">{subtitle}</p>
          </div>
          <div className="review-header-actions">
            <button className="btn btn-sm" onClick={onRefreshHistory} disabled={loading}>
              {loading ? '刷新中...' : '刷新审核'}
            </button>
            <button className="btn btn-sm" onClick={onRefreshArtifacts} disabled={artifactLoading}>
              {artifactLoading ? '刷新中...' : '刷新版本'}
            </button>
            {selectedEp !== 'all' && (
              <button className="btn btn-sm btn-primary" onClick={() => onOpenEpisodeScript(selectedEp)}>
                打开 EP{String(selectedEp).padStart(3, '0')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="review-scope card">
        <div className="review-section-head">
          <h3>处理范围</h3>
          <span className="text-secondary text-xs">
            {selectedEp === 'all' ? '当前查看全项目' : `当前聚焦 EP${String(selectedEp).padStart(3, '0')}`}
          </span>
        </div>
        <div className="review-scope-track">
          <button
            className={`review-scope-chip ${selectedEp === 'all' ? 'is-active' : ''}`}
            onClick={() => onSelectEpisode('all')}
          >
            全部集数
          </button>
          {epList.map((episodeNum) => {
            const row = qualityRows.find((item) => item.episodeNum === episodeNum)
            const hasProblem = !!row && (row.failCount > 0 || row.criticalCount > 0)
            return (
              <button
                key={episodeNum}
                className={`review-scope-chip ${selectedEp === episodeNum ? 'is-active' : ''} ${hasProblem ? 'has-problem' : ''}`}
                onClick={() => onSelectEpisode(episodeNum)}
              >
                EP{String(episodeNum).padStart(3, '0')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="review-overview-grid">
        <div className="card review-overview-card">
          <span className="review-overview-label">待处理阻塞</span>
          <strong className={reviewFailedData || blockerRows.length > 0 ? 'text-error' : 'text-success'}>
            {(reviewFailedData ? 1 : 0) + blockerRows.length}
          </strong>
        </div>
        <div className="card review-overview-card">
          <span className="review-overview-label">当前范围审核数</span>
          <strong>{totalReviews}</strong>
        </div>
        <div className="card review-overview-card">
          <span className="review-overview-label">平均分</span>
          <strong className={avgScore >= 8 ? 'text-success' : avgScore >= 6 ? 'text-warning' : 'text-error'}>
            {avgScore || '—'}
          </strong>
        </div>
        <div className="card review-overview-card">
          <span className="review-overview-label">高风险问题</span>
          <strong className={criticalCount > 0 ? 'text-error' : 'text-success'}>{criticalCount}</strong>
        </div>
        <div className="card review-overview-card">
          <span className="review-overview-label">已成稿集数</span>
          <strong>{scriptReadyCount}/{Math.max(epList.length, 1)}</strong>
        </div>
        <div className="card review-overview-card">
          <span className="review-overview-label">最近通过集</span>
          <strong>{episodePassCount}</strong>
        </div>
      </div>

      <div className="review-layout">
        <section className="review-main-column">
          <div className="card review-inbox">
            <div className="review-section-head">
              <h3>待处理问题</h3>
              <span className="text-secondary text-xs">先处理真正阻塞流程的项，再看完整时间线。</span>
            </div>
            <div className="review-inbox-list">
              {reviewFailedData && adaptBlockingReview && (
                <div className="review-inbox-item is-blocking">
                  <div className="review-inbox-main">
                    <div className="review-inbox-top">
                      <span className="review-pill is-danger">编剧阻塞</span>
                      <span className="review-pill">{formatStage(reviewFailedData.stage)}</span>
                      <span className="review-pill">重试 {reviewFailedData.retryCount}</span>
                      {reviewFailedData.batchNum && <span className="review-pill">批次 {reviewFailedData.batchNum}</span>}
                    </div>
                    <strong>
                      当前存在待修订失败项
                      {adaptBlockingReview.score ? ` · ${adaptBlockingReview.score} 分` : ''}
                    </strong>
                    <p className="text-secondary">{adaptBlockingHint}</p>
                    <div className="review-inbox-feedback">
                      <SimpleMarkdown content={adaptBlockingReview.feedback} />
                    </div>
                  </div>
                  <div className="review-inbox-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => onOpenStageWorkspace(reviewFailedData.stage)}>
                      去处理
                    </button>
                  </div>
                </div>
              )}

              {blockerRows.length === 0 && !reviewFailedData ? (
                <div className="review-empty-card">
                  <strong>当前没有待处理阻塞</strong>
                  <p className="text-secondary">你可以继续推进写作，或进入下方时间线回看完整质检记录。</p>
                </div>
              ) : (
                blockerRows.map((row) => (
                  <div key={row.episodeNum} className={`review-inbox-item ${row.failCount > 0 || row.criticalCount > 0 ? 'is-warning' : ''}`}>
                    <div className="review-inbox-main">
                      <div className="review-inbox-top">
                        <span className="review-pill">EP{String(row.episodeNum).padStart(3, '0')}</span>
                        <span className={`review-pill ${row.hasScript ? 'is-success' : 'is-warning'}`}>
                          {row.hasScript ? '已成稿' : '待写作'}
                        </span>
                        {row.lastReview && <span className="review-pill">{formatStage(row.lastReview.stage)}</span>}
                      </div>
                      <strong>
                        {!row.hasScript
                          ? '当前还没有剧本文件'
                          : row.lastReview && !row.lastReview.passed
                            ? `最近一次 ${formatStage(row.lastReview.stage)} 审核未通过`
                            : '仍存在待确认问题'}
                      </strong>
                      <p className="text-secondary">
                        {!row.hasScript
                          ? '该集还没有剧本文件，不能进入后续制作与审核闭环。'
                          : `失败 ${row.failCount} 次 · 严重问题 ${row.criticalCount} 个 · 累计问题 ${row.issueCount} 个`}
                      </p>
                    </div>
                    <div className="review-inbox-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => onOpenStageWorkspace(row.lastReview?.stage || 'script', row.episodeNum)}
                      >
                        {!row.hasScript ? '去撰写' : '去处理'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card review-quality-board">
            <div className="review-section-head">
              <h3>分集质量看板</h3>
              <span className="text-secondary text-xs">用每一集的可交付状态来组织，而不是只看流水日志。</span>
            </div>
            {visibleQualityRows.length === 0 ? (
              <EmptyState icon="📄" title="当前没有可展示的集数" description="请先完成项目同步，或在项目中补齐集数。" />
            ) : (
              <div className="review-quality-grid">
                {visibleQualityRows.map((row) => (
                  <div key={row.episodeNum} className={`review-quality-card ${row.failCount > 0 || row.criticalCount > 0 ? 'has-problem' : row.hasScript ? 'is-ready' : 'is-empty'}`}>
                    <div className="review-quality-head">
                      <strong>EP{String(row.episodeNum).padStart(3, '0')}</strong>
                      <span className="review-quality-status">{getEpisodeStatusLabel(row.status)}</span>
                    </div>
                    <div className="review-quality-badges">
                      <span className={`review-pill ${row.hasScript ? 'is-success' : 'is-warning'}`}>
                        {row.hasScript ? '剧本已就绪' : '缺剧本'}
                      </span>
                      <span className="review-pill">审核 {row.reviewCount}</span>
                      <span className={`review-pill ${row.criticalCount > 0 ? 'is-danger' : ''}`}>严重 {row.criticalCount}</span>
                      <span className="review-pill">版本 {row.artifactCount}</span>
                    </div>
                    <p className="text-secondary">
                      {row.lastReview
                        ? `最近一次 ${formatStage(row.lastReview.stage)} 审核 ${row.lastReview.passed ? '通过' : '未通过'}，得分 ${row.lastReview.score}。`
                        : row.hasScript
                          ? '已有剧本，但还没有审核记录。'
                          : '当前还未形成剧本，也就没有后续审核记录。'}
                    </p>
                    <div className="review-quality-meta text-secondary">
                      <span>已完成阶段：{row.completedStages.length > 0 ? row.completedStages.map(formatStage).join(' / ') : '暂无'}</span>
                      <span>更新时间：{formatDateTime(row.updatedAt)}</span>
                    </div>
                    <div className="review-quality-actions">
                      <button className="btn btn-sm" onClick={() => onOpenEpisodeScript(row.episodeNum)}>
                        打开剧本
                      </button>
                      <button className="btn btn-sm" onClick={() => onOpenEpisodePipeline(row.episodeNum)} disabled={!row.hasScript}>
                        查看制作
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card review-timeline">
            <div className="review-section-head">
              <h3>审核时间线</h3>
              <span className="text-secondary text-xs">
                {selectedEp === 'all' ? '按时间查看所有审核记录' : `当前仅展示 EP${String(selectedEp).padStart(3, '0')}`}
              </span>
            </div>
            {selectedReviewEntries.length === 0 ? (
              <EmptyState
                icon="📝"
                title={loading ? '审核记录加载中...' : '暂无审核记录'}
                description={loading ? undefined : '请先执行编剧或制作阶段的任务，系统才会沉淀审核历史。'}
              />
            ) : (
              <div className="review-record-list">
                {selectedReviewEntries.map((entry) => {
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
                          <span>{entry.review.issues.length} 个问题</span>
                          <span>{formatDateTime(entry.review.createdAt)}</span>
                          <span>{isExpanded ? '收起' : '展开'}</span>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="review-record-body">
                          {entry.review.issues.length > 0 && (
                            <div className="review-issues">
                              {entry.review.issues.map((issue, index) => {
                                const severity = SEVERITY_MAP[issue.severity] || SEVERITY_MAP.minor
                                return (
                                  <div key={`${reviewKey}-${index}`} className="review-issue-row">
                                    <span className={`review-issue-severity ${severity.cls}`}>{severity.label}</span>
                                    <div className="review-issue-copy">
                                      <strong>{issue.description}</strong>
                                      {issue.suggestion && <p className="text-secondary">建议：{issue.suggestion}</p>}
                                      {issue.location && <p className="text-secondary">位置：{issue.location}</p>}
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
        </section>

        <aside className="review-sidebar">
          <div className="card review-status-card">
            <div className="review-section-head">
              <h3>当前状态</h3>
              <span className={`review-pill ${reviewFailedData ? 'is-danger' : isRunning ? 'is-warning' : 'is-success'}`}>
                {reviewFailedData ? '待处理' : isRunning ? '运行中' : '稳定'}
              </span>
            </div>
            <div className="review-status-list">
              <div className="review-status-row">
                <span className="text-secondary">编剧状态</span>
                <strong>{adaptState}</strong>
              </div>
              <div className="review-status-row">
                <span className="text-secondary">当前范围通过</span>
                <strong>{passCount}/{Math.max(totalReviews, 1)}</strong>
              </div>
              <div className="review-status-row">
                <span className="text-secondary">当前范围失败</span>
                <strong className={failCount > 0 ? 'text-error' : ''}>{failCount}</strong>
              </div>
              <div className="review-status-row">
                <span className="text-secondary">累计问题</span>
                <strong>{totalIssues}</strong>
              </div>
            </div>
          </div>

          <div className="card review-artifact-card">
            <div className="review-section-head">
              <h3>产物版本</h3>
              <span className="text-secondary text-xs">{artifactGroupEntries.length} 个范围</span>
            </div>
            {visibleArtifactGroups.length === 0 ? (
              <EmptyState
                icon="🗂️"
                title={artifactLoading ? '版本加载中...' : '暂无产物版本'}
                description={artifactLoading ? undefined : '当前范围内还没有纳入 manifest 的产物记录。'}
              />
            ) : (
              <div className="review-artifact-list">
                {visibleArtifactGroups.map((versions) => {
                  const current = versions.find((artifact) => artifact.isCurrent) || versions[0]
                  return (
                    <div key={current.scopeKey} className="review-artifact-item">
                      <div className="review-artifact-head">
                        <div>
                          <strong>{current.label}</strong>
                          <p className="text-secondary">{current.filePath}</p>
                        </div>
                        <span className="review-pill">共 {versions.length} 版</span>
                      </div>
                      <div className="review-artifact-versions">
                        {versions.map((artifact) => (
                          <div key={artifact.id} className="review-artifact-version">
                            <div className="review-artifact-meta">
                              <span className={`review-pill ${artifact.isCurrent ? 'is-success' : ''}`}>v{artifact.version}</span>
                              <span className="text-secondary">{formatDateTime(artifact.createdAt)}</span>
                              <span className="text-secondary">{Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB</span>
                            </div>
                            {!artifact.isCurrent && (
                              <button
                                className="btn btn-sm"
                                onClick={() => onRollbackArtifact(artifact.id)}
                                disabled={rollingBackArtifactId === artifact.id}
                              >
                                {rollingBackArtifactId === artifact.id ? '回滚中...' : '回滚'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {artifactGroupEntries.length > visibleArtifactGroups.length && (
                  <div className="text-secondary text-xs">
                    当前范围共有 {artifactGroupEntries.length} 个产物范围，页面先展示最近 {visibleArtifactGroups.length} 个。
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
