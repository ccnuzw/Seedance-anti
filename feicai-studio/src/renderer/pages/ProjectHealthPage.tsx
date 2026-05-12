import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import ProjectIntegrityCard from '@renderer/components/project/ProjectIntegrityCard'
import { getExceptionMessage } from '@renderer/services/service-contracts'
import {
  getProjectPipelineState,
  inspectProjectDirectory,
  repairProjectIssues
} from '@renderer/services/project-service'
import type {
  DetectedProjectInfo,
  ProjectReadyItem,
  ProjectRepairActionId
} from '@shared/project-detection'
import { normalizeProjectConfig } from '@shared/project-config'
import type { ProjectRepairResult } from '@shared/ipc-contracts'
import {
  buildProjectExperienceSummary,
  buildStageDrilldownSummary
} from '@renderer/components/project/project-experience-view'
import { PROJECT_STATUS_MAP } from '@renderer/components/project/project-page-view'
import type { ProjectPipelineState, WorkflowStageId } from '@shared/types'

interface RecommendedStep {
  label: string
  path: string
  description: string
}

function resolveBatchModeByStage(
  stageId: WorkflowStageId
): 'full' | 'director' | 'art' | 'storyboard' {
  if (stageId === 'director') return 'director'
  if (stageId === 'art') return 'art'
  if (
    stageId === 'storyboard' ||
    stageId === 'storyboard_review' ||
    stageId === 'complete'
  ) {
    return 'storyboard'
  }
  return 'full'
}

function buildRecommendedSteps(
  projectId: string,
  entryStage: 'novel' | 'story' | 'script'
): RecommendedStep[] {
  if (entryStage === 'novel') {
    return [
      {
        label: '完善小说原文',
        path: `/project/${projectId}/source`,
        description: '先补齐 source/novel.md，再进入剧情拆解。'
      },
      {
        label: '进入剧情拆解',
        path: `/project/${projectId}/story?ep=1`,
        description: '原文和设定已经齐备时，直接开始 EP01 拆解。'
      }
    ]
  }

  if (entryStage === 'story') {
    return [
      {
        label: '完善首集剧情',
        path: `/project/${projectId}/story?ep=1`,
        description: '先把 EP01 剧情拆解写完整，再生成剧本。'
      },
      {
        label: '进入剧本编辑',
        path: `/project/${projectId}/script?ep=1`,
        description: '剧情已经齐全时，直接推进到剧本阶段。'
      }
    ]
  }

  return [
    {
      label: '完善首集剧本',
      path: `/project/${projectId}/script?ep=1`,
      description: '先补齐 EP01 剧本内容，再继续后续审核和制作。'
    },
    {
      label: '进入流水线',
      path: `/project/${projectId}/pipeline?ep=1`,
      description: '剧本已就绪时，直接进入后续流程。'
    }
  ]
}

export default function ProjectHealthPage() {
  const navigate = useNavigate()
  const currentProject = useProjectStore((s) => s.currentProject)
  const episodes = useProjectStore((s) => s.episodes)
  const syncEpisodeStatus = useProjectStore((s) => s.syncEpisodeStatus)
  const loadProject = useProjectStore((s) => s.loadProject)
  const { addToast } = useToastStore()
  const [detected, setDetected] = useState<DetectedProjectInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoadingIds, setActionLoadingIds] = useState<
    ProjectRepairActionId[]
  >([])
  const [readyItems, setReadyItems] = useState<ProjectReadyItem[]>([])
  const [repairPreview, setRepairPreview] =
    useState<ProjectRepairResult | null>(null)
  const [projectPipelineState, setProjectPipelineState] =
    useState<ProjectPipelineState | null>(null)
  const [selectedStageId, setSelectedStageId] =
    useState<WorkflowStageId>('script_review')

  const report = detected?.integrity
  const config = normalizeProjectConfig(currentProject?.config)
  const recommendedActionIds = useMemo(
    () => report?.recommendedActions?.map((action) => action.id) || [],
    [report]
  )
  const summary = useMemo(
    () =>
      buildProjectExperienceSummary({
        episodes,
        config: currentProject?.config,
        projectPipelineState,
        integrityReport: report,
        readyItems,
        projectId: currentProject?.id
      }),
    [
      episodes,
      currentProject?.config,
      currentProject?.id,
      projectPipelineState,
      readyItems,
      report
    ]
  )
  const stageDrilldown = useMemo(
    () =>
      buildStageDrilldownSummary({
        episodes,
        stageId: selectedStageId
      }),
    [episodes, selectedStageId]
  )
  const navigateToBatch = (
    targetEpisodes: number[],
    stageId: WorkflowStageId
  ) => {
    if (!currentProject || targetEpisodes.length === 0) return
    const params = new URLSearchParams({
      mode: resolveBatchModeByStage(stageId),
      episodes: targetEpisodes.join(',')
    })
    navigate(`/project/${currentProject.id}/batch?${params.toString()}`)
  }
  const recommendedSteps = currentProject
    ? buildRecommendedSteps(currentProject.id, config.entryStage)
    : []
  const nextPath = !currentProject
    ? '/'
    : config.entryStage === 'novel'
      ? `/project/${currentProject.id}/source`
      : config.entryStage === 'story'
        ? `/project/${currentProject.id}/story?ep=1`
        : `/project/${currentProject.id}/script?ep=1`

  const loadInspection = async () => {
    if (!currentProject) return
    setLoading(true)
    try {
      const result = await inspectProjectDirectory(currentProject.projectPath)
      setDetected(result)
      setRepairPreview(null)
      const state = await getProjectPipelineState(currentProject.projectPath)
      setProjectPipelineState(state)
      const readiness = await repairProjectIssues({
        projectPath: currentProject.projectPath,
        actionIds: [],
        trustMode: 'registered',
        dryRun: true
      })
      setReadyItems(readiness.readyItems)
    } catch (error) {
      addToast('error', getExceptionMessage(error, '项目体检失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadInspection()
  }, [currentProject?.id])

  useEffect(() => {
    if (summary.stageTimeline.some((item) => item.id === selectedStageId))
      return
    const fallbackStage = summary.stageTimeline.find(
      (item) => item.state === 'active'
    )
    if (fallbackStage) setSelectedStageId(fallbackStage.id)
  }, [summary.stageTimeline, selectedStageId])

  const handleRepairActions = async (
    actionIds: ProjectRepairActionId[],
    dryRun = false
  ) => {
    if (!currentProject || actionIds.length === 0) return
    setActionLoadingIds(actionIds)
    try {
      const result = await repairProjectIssues({
        projectPath: currentProject.projectPath,
        actionIds,
        trustMode: 'registered',
        dryRun
      })
      setRepairPreview(result)
      if (dryRun) {
        setReadyItems(result.readyItems)
        addToast('info', result.message)
      } else {
        setDetected(result.detected)
        setReadyItems(result.readyItems)
        await loadProject(currentProject.id)
        await syncEpisodeStatus()
        const state = await getProjectPipelineState(currentProject.projectPath)
        setProjectPipelineState(state)
        addToast('success', result.message)
      }
    } catch (error) {
      addToast('error', getExceptionMessage(error, '项目修复失败'))
    } finally {
      setActionLoadingIds([])
    }
  }

  if (!currentProject) {
    return (
      <div className="project-empty-state">
        <div className="empty-icon">🧪</div>
        <h2>未选择项目</h2>
        <p className="text-secondary">
          请先从仪表盘打开一个项目，再进入项目体检与修复中心。
        </p>
      </div>
    )
  }

  return (
    <div className="project-page">
      <div className="project-header">
        <div className="project-info">
          <h1 className="project-name">🧭 项目体验中心</h1>
          <div className="project-meta text-secondary">
            <span>{currentProject.name}</span>
            <span className="meta-sep">·</span>
            <span>{currentProject.projectPath}</span>
          </div>
        </div>
        <div className="project-actions">
          <button
            className="btn"
            onClick={() => void loadInspection()}
            disabled={loading}
          >
            {loading ? '⏳ 体检中...' : '↻ 重新体检'}
          </button>
          {recommendedActionIds.length > 0 && (
            <button
              className="btn"
              onClick={() =>
                void handleRepairActions(recommendedActionIds, true)
              }
              disabled={actionLoadingIds.length > 0}
            >
              预览修复建议项
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => navigate(nextPath)}
          >
            进入项目
          </button>
        </div>
      </div>

      <div className="project-health-grid">
        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>📈 项目概览</h3>
            <span className="text-secondary">{summary.entryLabel}</span>
          </div>
          <div className="project-health-stats">
            <div className="project-health-stat">
              <span className="text-secondary">总进度</span>
              <strong>{summary.progressPct}%</strong>
              <span className="text-secondary">
                {summary.completedCount}/
                {episodes.length || currentProject.totalEpisodes} 集完成
              </span>
            </div>
            <div className="project-health-stat">
              <span className="text-secondary">进行中</span>
              <strong>{summary.inProgressCount}</strong>
              <span className="text-secondary">
                待开始 {summary.idleCount} 集
              </span>
            </div>
            <div className="project-health-stat">
              <span className="text-secondary">健康评分</span>
              <strong>{summary.healthScore.score} / 100</strong>
              <span className="text-secondary">
                {summary.healthScore.grade} · {summary.healthScore.label}
              </span>
            </div>
            <div className="project-health-stat">
              <span className="text-secondary">当前焦点阶段</span>
              <strong>{summary.currentFocusStageLabel}</strong>
              <span className="text-secondary">
                {summary.pipelineUpdatedAt
                  ? `更新于 ${new Date(summary.pipelineUpdatedAt).toLocaleString('zh-CN')}`
                  : '暂无流水线持久化状态'}
              </span>
            </div>
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🚨 风险面板</h3>
            <span className="text-secondary">
              {summary.risks.length} 项风险
            </span>
          </div>
          <div className="project-health-list">
            {summary.risks.length > 0 ? (
              summary.risks.map((risk) => (
                <div
                  key={risk.id}
                  className={`project-health-row project-risk-row project-risk-row--${risk.severity}`}
                >
                  <div>
                    <div className="project-health-label">
                      {risk.severity === 'high'
                        ? '⛔'
                        : risk.severity === 'medium'
                          ? '⚠️'
                          : 'ℹ️'}{' '}
                      {risk.title}
                    </div>
                    <div className="text-secondary">{risk.detail}</div>
                  </div>
                  {risk.actionLabel && risk.actionPath ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => navigate(risk.actionPath)}
                    >
                      {risk.actionLabel}
                    </button>
                  ) : (
                    <span
                      className={`badge ${risk.severity === 'high' ? 'badge-danger' : risk.severity === 'medium' ? 'badge-warning' : 'badge-info'}`}
                    >
                      {risk.severity === 'high'
                        ? '高'
                        : risk.severity === 'medium'
                          ? '中'
                          : '低'}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="text-secondary">
                当前没有识别到显著风险，项目可继续推进。
              </div>
            )}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>📊 阶段趋势</h3>
            <span className="text-secondary">按全项目覆盖率统计</span>
          </div>
          <div className="project-trend-list">
            {summary.stageTimeline.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`project-trend-row project-trend-button ${selectedStageId === item.id ? 'project-trend-button--active' : ''}`}
                onClick={() => setSelectedStageId(item.id)}
              >
                <div className="project-trend-head">
                  <strong>{item.shortLabel}</strong>
                  <span className="text-secondary">
                    {item.completedEpisodes}/
                    {episodes.length || currentProject.totalEpisodes} 集
                  </span>
                </div>
                <div className="progress-bar-bg">
                  <div
                    className={`progress-bar-fill project-trend-fill project-trend-fill--${item.state}`}
                    style={{ width: `${item.coveragePct}%` }}
                  />
                </div>
                <div className="text-secondary">
                  {item.label} · {item.coveragePct}%
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>✅ 项目就绪情况</h3>
            <span className="text-secondary">
              {readyItems.filter((item) => item.exists).length}/
              {readyItems.length} 项已就绪
            </span>
          </div>
          <div className="project-health-list">
            {readyItems.map((item: ProjectReadyItem) => (
              <div key={item.path} className="project-health-row">
                <div>
                  <div className="project-health-label">
                    {item.exists ? '✅' : '⚪'} {item.label}
                  </div>
                  <div className="text-secondary project-health-path">
                    {item.path}
                  </div>
                </div>
                <span
                  className={`badge ${item.exists ? 'badge-success' : 'badge-secondary'}`}
                >
                  {item.exists ? '已就绪' : '待补齐'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🛤 项目时间线</h3>
            <span className="text-secondary">当前推进轨迹</span>
          </div>
          <div className="project-timeline">
            {summary.stageTimeline.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`project-timeline-item project-timeline-item--${item.state} ${selectedStageId === item.id ? 'project-timeline-item--selected' : ''}`}
                onClick={() => setSelectedStageId(item.id)}
              >
                <div className="project-timeline-dot" />
                <div className="project-timeline-body">
                  <div className="project-timeline-title">
                    <strong>{item.label}</strong>
                    <span
                      className={`badge ${item.state === 'done' ? 'badge-success' : item.state === 'active' ? 'badge-warning' : 'badge-secondary'}`}
                    >
                      {item.state === 'done'
                        ? '已推进'
                        : item.state === 'active'
                          ? '当前焦点'
                          : '待推进'}
                    </span>
                  </div>
                  <div className="text-secondary">{item.hint}</div>
                  <div className="text-secondary">
                    {item.completedEpisodes}/
                    {episodes.length || currentProject.totalEpisodes}{' '}
                    集达到该阶段
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🔎 阶段下钻</h3>
            <span className="text-secondary">{stageDrilldown.stageLabel}</span>
          </div>
          <div className="project-drilldown-grid">
            <div className="project-drilldown-column">
              <div className="project-drilldown-head">
                <strong>已到达后续阶段</strong>
                <div className="project-drilldown-actions">
                  <span className="badge badge-success">
                    {stageDrilldown.reached.length}
                  </span>
                  {stageDrilldown.reached.length > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        navigateToBatch(
                          stageDrilldown.reached.map(
                            (item) => item.episodeNumber
                          ),
                          selectedStageId
                        )
                      }
                    >
                      批量调度
                    </button>
                  )}
                </div>
              </div>
              <div className="project-health-list">
                {stageDrilldown.reached.length > 0 ? (
                  stageDrilldown.reached.map((item) => (
                    <button
                      key={`reached-${item.episodeNumber}`}
                      type="button"
                      className="project-step-card"
                      onClick={() =>
                        navigate(
                          `/project/${currentProject.id}/pipeline?ep=${item.episodeNumber}`
                        )
                      }
                    >
                      <span className="project-step-title">
                        EP{String(item.episodeNumber).padStart(2, '0')} ·{' '}
                        {item.title}
                      </span>
                      <span className="text-secondary">
                        当前阶段：{item.stageLabel}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="text-secondary">暂无已越过该阶段的集数。</div>
                )}
              </div>
            </div>

            <div className="project-drilldown-column">
              <div className="project-drilldown-head">
                <strong>当前卡在该阶段</strong>
                <div className="project-drilldown-actions">
                  <span className="badge badge-warning">
                    {stageDrilldown.blocked.length}
                  </span>
                  {stageDrilldown.blocked.length > 0 && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() =>
                        navigateToBatch(
                          stageDrilldown.blocked.map(
                            (item) => item.episodeNumber
                          ),
                          selectedStageId
                        )
                      }
                    >
                      批量调度
                    </button>
                  )}
                </div>
              </div>
              <div className="project-health-list">
                {stageDrilldown.blocked.length > 0 ? (
                  stageDrilldown.blocked.map((item) => (
                    <button
                      key={`blocked-${item.episodeNumber}`}
                      type="button"
                      className="project-step-card"
                      onClick={() =>
                        navigate(
                          `/project/${currentProject.id}/pipeline?ep=${item.episodeNumber}`
                        )
                      }
                    >
                      <span className="project-step-title">
                        EP{String(item.episodeNumber).padStart(2, '0')} ·{' '}
                        {item.title}
                      </span>
                      <span className="text-secondary">
                        当前阶段：{item.stageLabel}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="text-secondary">
                    当前没有集数卡在这个阶段。
                  </div>
                )}
              </div>
            </div>

            <div className="project-drilldown-column">
              <div className="project-drilldown-head">
                <strong>尚未到达该阶段</strong>
                <div className="project-drilldown-actions">
                  <span className="badge badge-secondary">
                    {stageDrilldown.pending.length}
                  </span>
                  {stageDrilldown.pending.length > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        navigateToBatch(
                          stageDrilldown.pending.map(
                            (item) => item.episodeNumber
                          ),
                          selectedStageId
                        )
                      }
                    >
                      批量调度
                    </button>
                  )}
                </div>
              </div>
              <div className="project-health-list">
                {stageDrilldown.pending.length > 0 ? (
                  stageDrilldown.pending.map((item) => (
                    <button
                      key={`pending-${item.episodeNumber}`}
                      type="button"
                      className="project-step-card"
                      onClick={() =>
                        navigate(
                          `/project/${currentProject.id}/pipeline?ep=${item.episodeNumber}`
                        )
                      }
                    >
                      <span className="project-step-title">
                        EP{String(item.episodeNumber).padStart(2, '0')} ·{' '}
                        {item.title}
                      </span>
                      <span className="text-secondary">
                        当前阶段：{item.stageLabel}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="text-secondary">
                    所有集数都已至少推进到这个阶段。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🧱 阶段覆盖</h3>
            <span className="text-secondary">当前项目产物进度</span>
          </div>
          <div className="project-health-list">
            {summary.stageCoverage.map((item) => (
              <div key={item.key} className="project-health-row">
                <div className="project-health-label">{item.label}</div>
                <span className="badge badge-info">{item.count} 集</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🕒 最近活跃集数</h3>
            <span className="text-secondary">按最近更新时间排序</span>
          </div>
          <div className="project-health-list">
            {summary.recentEpisodes.length > 0 ? (
              summary.recentEpisodes.map((item) => {
                const meta = PROJECT_STATUS_MAP[item.status]
                return (
                  <button
                    key={item.episodeNumber}
                    type="button"
                    className="project-step-card"
                    onClick={() =>
                      navigate(
                        `/project/${currentProject.id}/pipeline?ep=${item.episodeNumber}`
                      )
                    }
                  >
                    <span className="project-step-title">
                      EP{String(item.episodeNumber).padStart(2, '0')} ·{' '}
                      {item.title}
                    </span>
                    <span className="text-secondary">
                      {meta?.emoji || '📍'} {meta?.label || item.stageLabel}
                    </span>
                  </button>
                )
              })
            ) : (
              <div className="text-secondary">当前还没有集数活动记录。</div>
            )}
          </div>
        </div>

        <div className="card project-health-section">
          <div className="pipeline-settings-header">
            <h3>🧭 推荐下一步</h3>
            <span className="text-secondary">按当前入口阶段生成</span>
          </div>
          <div className="project-health-list">
            {recommendedSteps.map((step) => (
              <button
                key={step.path}
                type="button"
                className="project-step-card"
                onClick={() => navigate(step.path)}
              >
                <span className="project-step-title">{step.label}</span>
                <span className="text-secondary">{step.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {report ? (
        <ProjectIntegrityCard
          title="🧪 项目体检与修复"
          report={report}
          actionLoadingIds={actionLoadingIds}
          onRepairAction={(actionId) => {
            void handleRepairActions([actionId])
          }}
          onRepairAll={
            recommendedActionIds.length > 0
              ? () => {
                  void handleRepairActions(recommendedActionIds)
                }
              : undefined
          }
        />
      ) : (
        <div className="card" style={{ marginTop: 'var(--spacing-md)' }}>
          <div className="text-secondary">
            {loading ? '正在扫描项目结构...' : '暂无体检报告'}
          </div>
        </div>
      )}

      {repairPreview && (
        <div
          className="card project-health-section"
          style={{ marginTop: 'var(--spacing-md)' }}
        >
          <div className="pipeline-settings-header">
            <h3>{repairPreview.dryRun ? '📝 修复预览' : '📝 最近修复结果'}</h3>
            <span
              className={`badge ${repairPreview.dryRun ? 'badge-warning' : 'badge-success'}`}
            >
              {repairPreview.dryRun ? '预览模式' : '已执行'}
            </span>
          </div>
          <div
            className="text-secondary"
            style={{ marginBottom: 'var(--spacing-sm)' }}
          >
            {repairPreview.message}
          </div>
          <div className="project-health-list">
            {repairPreview.plannedChanges.length > 0 ? (
              repairPreview.plannedChanges.map((change) => (
                <div key={change} className="project-health-row">
                  <div className="project-health-label">• {change}</div>
                </div>
              ))
            ) : (
              <div className="text-secondary">当前没有需要执行的变更。</div>
            )}
          </div>
          {repairPreview.dryRun && recommendedActionIds.length > 0 && (
            <div
              className="pipeline-settings-actions"
              style={{ marginTop: 'var(--spacing-md)' }}
            >
              <button
                className="btn btn-primary"
                onClick={() => void handleRepairActions(recommendedActionIds)}
                disabled={actionLoadingIds.length > 0}
              >
                执行这些修复
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
