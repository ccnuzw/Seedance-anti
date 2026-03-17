import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import type { ReviewResult, PipelineStage } from '@shared/types'
import '@renderer/components/layout/EpisodeNav.css'
import './ReviewPage.css'

const STAGE_LABELS: Record<PipelineStage, string> = {
  director: '🎬 导演分析',
  art: '🎨 服化道设计',
  storyboard: '📐 分镜编写'
}

const SEVERITY_MAP: Record<string, { label: string; cls: string }> = {
  critical: { label: '严重', cls: 'severity-critical' },
  major: { label: '主要', cls: 'severity-major' },
  minor: { label: '轻微', cls: 'severity-minor' }
}

interface EpisodeState {
  reviews: ReviewResult[]
  completedStages: string[]
  status: string
  updatedAt: string
}

interface ProjectState {
  episodes: Record<number, EpisodeState>
}

export default function ReviewPage() {
  useProjectSync()
  const [searchParams] = useSearchParams()
  const episodeNum = parseInt(searchParams.get('ep') || '0')
  const { context } = usePipelineStore()
  const { currentProject, episodes } = useProjectStore()
  const { addToast } = useToastStore()
  const [expandedReview, setExpandedReview] = useState<number | null>(null)
  const [selectedEp, setSelectedEp] = useState<number | 'all'>(episodeNum || 'all')
  const [historicalState, setHistoricalState] = useState<ProjectState | null>(null)
  const [loading, setLoading] = useState(false)

  // 加载持久化状态
  const loadHistoricalState = useCallback(async (showToast = false) => {
    if (!currentProject) return
    setLoading(true)
    try {
      const state = await window.feicaiAPI.invoke(
        IPC.PROJECT_GET_PIPELINE_STATE,
        currentProject.projectPath
      ) as ProjectState | null
      setHistoricalState(state)
      if (showToast) addToast('success', '审核记录已刷新')
    } catch {
      setHistoricalState(null)
      addToast('error', '加载审核历史失败')
    }
    setLoading(false)
  }, [currentProject, addToast])

  useEffect(() => {
    loadHistoricalState()
  }, [loadHistoricalState])

  // 合并当前 session 和历史数据
  const getReviews = (): ReviewResult[] => {
    const sessionReviews = context?.reviews || []

    if (!historicalState?.episodes) {
      return sessionReviews
    }

    if (selectedEp === 'all') {
      // 所有集的历史审核
      const historicalReviews: ReviewResult[] = []
      for (const ep of Object.values(historicalState.episodes)) {
        if (ep.reviews) {
          historicalReviews.push(...ep.reviews)
        }
      }
      // 合并并去重（按 createdAt + stage）
      const allReviews = [...historicalReviews]
      for (const sr of sessionReviews) {
        const exists = allReviews.find(
          r => r.createdAt === sr.createdAt && r.stage === sr.stage
        )
        if (!exists) allReviews.push(sr)
      }
      return allReviews.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    }

    // 特定集数
    const epState = historicalState.episodes[selectedEp]
    const historical = epState?.reviews || []
    const session = sessionReviews.filter(r => {
      // session reviews don't have episodeNum, use all if selected ep matches context
      return context?.episodeNum === selectedEp
    })

    const allReviews = [...historical]
    for (const sr of session) {
      const exists = allReviews.find(
        r => r.createdAt === sr.createdAt && r.stage === sr.stage
      )
      if (!exists) allReviews.push(sr)
    }
    return allReviews.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  const reviews = getReviews()
  const epList = episodes.map(e => e.episodeNumber).sort((a, b) => a - b)

  // 汇总统计
  const totalReviews = reviews.length
  const passCount = reviews.filter(r => r.result === 'PASS').length
  const failCount = reviews.filter(r => r.result === 'FAIL').length
  const avgScore = totalReviews > 0
    ? Math.round(reviews.reduce((s, r) => s + r.score, 0) / totalReviews * 10) / 10
    : 0
  const totalIssues = reviews.reduce((sum, r) => sum + r.issues.length, 0)
  const criticalCount = reviews.reduce(
    (sum, r) => sum + r.issues.filter(i => i.severity === 'critical').length, 0
  )

  return (
    <div className="review-page">
      {/* 集数筛选 */}
      <div className="epnav" style={{ marginBottom: 'var(--spacing-md)' }}>
        <div className="epnav-track">
          <button
            className={`epnav-item ${selectedEp === 'all' ? 'epnav-active' : ''}`}
            onClick={() => setSelectedEp('all')}
          >
            <span className="epnav-num">全部</span>
          </button>
          {epList.map(ep => {
            const epData = episodes.find(e => e.episodeNumber === ep)
            const done = epData?.status === 'complete'
            return (
              <button
                key={ep}
                className={[
                  'epnav-item',
                  selectedEp === ep && 'epnav-active',
                  done && selectedEp !== ep && 'epnav-done'
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedEp(ep)}
                title={`EP${String(ep).padStart(2, '0')}`}
              >
                <span className="epnav-num">{String(ep).padStart(2, '0')}</span>
                {done && <span className="epnav-check">✓</span>}
              </button>
            )
          })}
          <button className="epnav-item" onClick={() => loadHistoricalState(true)} disabled={loading} title="刷新">
            <span className="epnav-num">🔄</span>
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="review-stats-grid">
        <div className="card stat-card">
          <div className="stat-value">{totalReviews}</div>
          <div className="stat-label text-secondary">审核次数</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value text-success">{passCount}</div>
          <div className="stat-label text-secondary">通过</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value text-error">{failCount}</div>
          <div className="stat-label text-secondary">未通过</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${avgScore >= 8 ? 'text-success' : avgScore >= 6 ? 'text-warning' : 'text-error'}`}>
            {avgScore}
          </div>
          <div className="stat-label text-secondary">平均分</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${criticalCount > 0 ? 'text-error' : 'text-success'}`}>
            {totalIssues}
          </div>
          <div className="stat-label text-secondary">问题总数</div>
        </div>
      </div>

      {/* 审核记录列表 */}
      <div className="review-list">
        <h3 className="section-title">
          审核记录
          {selectedEp !== 'all' && <span className="text-secondary"> — EP{String(selectedEp).padStart(2, '0')}</span>}
        </h3>
        {reviews.length === 0 ? (
          <div className="review-empty card text-secondary">
            {loading ? '加载中...' : '暂无审核记录。请先在流水线中执行阶段任务。'}
          </div>
        ) : (
          reviews.map((review, idx) => {
            const isPass = review.result === 'PASS'
            const isExpanded = expandedReview === idx
            return (
              <div
                key={idx}
                className={`card review-record ${isPass ? 'record-pass' : 'record-fail'}`}
              >
                <div
                  className="review-record-header"
                  onClick={() => setExpandedReview(isExpanded ? null : idx)}
                >
                  <div className="record-left">
                    <span className={`record-result badge ${isPass ? 'badge-success' : 'badge-danger'}`}>
                      {isPass ? '✅ PASS' : '❌ FAIL'}
                    </span>
                    <span className="record-stage">
                      {STAGE_LABELS[review.stage] || review.stage}
                    </span>
                    <span className="record-score">
                      {review.score} 分
                    </span>
                  </div>
                  <div className="record-right">
                    {review.issues.length > 0 && (
                      <span className="record-issues text-secondary">
                        {review.issues.length} 个问题
                      </span>
                    )}
                    <span className="record-time text-secondary">
                      {new Date(review.createdAt).toLocaleString('zh-CN')}
                    </span>
                    <span className="record-toggle">{isExpanded ? '▼' : '▶'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="review-record-body">
                    {review.issues.length > 0 && (
                      <div className="issues-section">
                        <h4 className="issues-title">问题列表</h4>
                        <div className="issues-list">
                          {review.issues.map((issue, i) => {
                            const sev = SEVERITY_MAP[issue.severity] || SEVERITY_MAP.minor
                            return (
                              <div key={i} className="issue-item">
                                <span className={`issue-severity ${sev.cls}`}>{sev.label}</span>
                                <span className="issue-desc">{issue.description}</span>
                                {issue.suggestion && (
                                  <div className="issue-suggestion text-secondary">
                                    💡 {issue.suggestion}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="feedback-section">
                      <h4 className="feedback-title">完整审核反馈</h4>
                      <pre className="feedback-content">{review.feedback}</pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
