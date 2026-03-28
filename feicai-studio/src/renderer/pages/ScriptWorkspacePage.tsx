import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { buildProjectRoute } from '@renderer/project-routing'
import ScriptQuickSettingsDrawer from '@renderer/components/script-workspace/ScriptQuickSettingsDrawer'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import {
  resolveBuiltinExportProfile,
  resolveBuiltinProjectPreset
} from '@shared/template-catalog'
import {
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_PROJECT_TASK_ALERTS,
  DEFAULT_PROJECT_TASK_DEFAULTS,
  DEFAULT_REVIEW_POLICY
} from '@shared/types'
import ReviewPage from './ReviewPage'
import AdaptScriptPage from './AdaptScriptPage'
import './ScriptWorkspacePage.css'

export default function ScriptWorkspacePage() {
  const navigate = useNavigate()
  const { currentProject, episodes, saveProjectConfig } = useProjectStore()
  const { addToast } = useToastStore()
  const [searchParams] = useSearchParams()
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false)
  const [quickSettingsSaving, setQuickSettingsSaving] = useState(false)
  const currentEpisode = useMemo(() => {
    const raw = Number.parseInt(searchParams.get('ep') || '0', 10)
    return Number.isFinite(raw) && raw > 0 ? raw : 'all'
  }, [searchParams])
  const issueFocused = searchParams.get('tab') === 'issues'
  const focusIssuePanel = () => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'issues')
    navigate({ search: `?${next.toString()}` })
  }
  const scriptsCount = episodes.filter((episode) => episode.hasScript).length
  const totalEpisodes = currentProject?.totalEpisodes || episodes.length || 0
  const projectPreset = resolveBuiltinProjectPreset(currentProject?.config.templateProfileId)
  const exportProfile = resolveBuiltinExportProfile(currentProject?.config.exportProfileId)
  const pipelineSettings = { ...DEFAULT_PIPELINE_SETTINGS, ...(currentProject?.config.pipelineSettings || {}) }
  const reviewPolicy = { ...DEFAULT_REVIEW_POLICY, ...(currentProject?.config.reviewPolicy || {}) }
  const taskDefaults = { ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(currentProject?.config.taskDefaults || {}) }
  const taskAlerts = { ...DEFAULT_PROJECT_TASK_ALERTS, ...(currentProject?.config.taskAlerts || {}) }
  const scriptRiskItems = [
    issueFocused ? '当前已聚焦问题面板' : null,
    scriptsCount < Math.max(totalEpisodes, 1) ? `仍有 ${Math.max(totalEpisodes - scriptsCount, 0)} 集待成稿` : null,
    currentProject?.sourceType === 'novel' ? '建议先确认内容准备和改编规划已稳定' : null
  ].filter((item): item is string => !!item)
  const policyTone = reviewPolicy.qaMode === 'strict'
    ? 'warning'
    : reviewPolicy.qaMode === 'report_only'
      ? 'info'
      : 'default'
  const policySummary = reviewPolicy.qaMode === 'strict'
    ? '当前项目按严格质检模式推进，建议先修问题再扩张新集数。'
    : reviewPolicy.qaMode === 'report_only'
      ? '当前项目以报告为主，质检结果更偏提示，不会形成过强阻塞。'
      : '当前项目按宽松质检模式推进，适合边写边补，但仍需关注高风险问题。'
  const policyItems = [
    projectPreset ? `当前预设：${projectPreset.label}` : '当前预设：未指定，按项目自定义参数执行',
    `剧本通过线：${reviewPolicy.adaptScriptPassScore ?? pipelineSettings.passScore} 分`,
    `自动修订：${reviewPolicy.scriptAutoRepairRounds ?? 0} 轮`,
    `默认批量：${taskDefaults.defaultBatchMode === 'independent' ? '独立并行' : taskDefaults.defaultBatchMode === 'sequential_on_success' ? '成功后串行' : '始终串行'}`,
    `默认重试：${taskDefaults.defaultMaxAutoRetries} 次`,
    exportProfile ? `交付默认：${exportProfile.label}` : '交付默认：未指定',
    taskAlerts.notifyOnRunFailed ? '失败告警：已开启' : '失败告警：未开启'
  ]

  useEffect(() => {
    if (!currentProject) {
      setQuickSettingsOpen(false)
    }
  }, [currentProject?.id])

  const handleSaveQuickSettings = async (payload: {
    reviewPolicy: {
      qaMode: 'strict' | 'lenient' | 'report_only'
      adaptScriptPassScore: number
      scriptAutoRepairRounds: number
    }
    taskDefaults: {
      defaultBatchMode: 'independent' | 'sequential_on_success' | 'sequential_always'
      defaultMaxAutoRetries: number
    }
  }) => {
    if (!currentProject) return
    setQuickSettingsSaving(true)
    try {
      await saveProjectConfig(currentProject.projectPath, {
        reviewPolicy: {
          ...(currentProject.config.reviewPolicy || {}),
          ...payload.reviewPolicy
        },
        taskDefaults: {
          ...(currentProject.config.taskDefaults || {}),
          ...payload.taskDefaults
        }
      })
      addToast('success', '写作快速设置已应用')
      setQuickSettingsOpen(false)
    } catch (error) {
      addToast('error', `保存失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setQuickSettingsSaving(false)
    }
  }

  return (
    <div className="script-workspace-page page-container page-xl">
      <div className={`card script-workspace-header ${issueFocused ? 'is-issue-focused' : ''}`}>
        <div className="script-workspace-copy">
          <h1>剧本创作</h1>
          <p className="text-secondary">
            在一个工作区里完成选集、生成、编辑、修订和查看写作质检问题，不再在“剧本页”和“质检页”之间来回跳转。
          </p>
        </div>
        <div className="script-workspace-actions">
          {currentProject && (
            <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings', 'tab=flow'))}>
              写作参数
            </button>
          )}
          <button className="btn" onClick={() => navigate('/tasks')}>
            打开任务中心
          </button>
          <button className="btn btn-primary" onClick={focusIssuePanel}>
            聚焦问题面板
          </button>
        </div>
      </div>

      <div className={`card action-guidance ${issueFocused ? 'tone-warning' : scriptsCount > 0 ? 'tone-default' : 'tone-info'}`}>
        <div className="action-guidance-head">
          <h3>创作动作提示</h3>
          <span className="text-secondary text-xs">
            {issueFocused ? '先修问题再扩写' : scriptsCount > 0 ? '继续围绕当前集推进' : '先形成第一批成稿'}
          </span>
        </div>
        <p className="text-secondary">
          {issueFocused
            ? '当前视图已经聚焦问题面板。建议先处理审核失败项，避免错误继续传导到后续制作。'
            : scriptsCount > 0
              ? '当前已经有部分成稿。建议优先推进未完成集数，并在需要时回看问题面板。'
              : '当前还没有稳定剧本产物。建议先完成首批成稿，再进入交付判断或制作阶段。'}
        </p>
        {scriptRiskItems.length > 0 && (
          <div className="action-guidance-list">
            {scriptRiskItems.map((item) => (
              <span key={item} className="action-guidance-chip">{item}</span>
            ))}
          </div>
        )}
      </div>

      <div className={`card script-policy-strip tone-${policyTone}`}>
        <div className="script-policy-copy">
          <div className="action-guidance-head">
            <h3>当前写作策略</h3>
            <span className="text-secondary text-xs">
              {reviewPolicy.qaMode === 'strict' ? '严格门禁' : reviewPolicy.qaMode === 'report_only' ? '报告优先' : '宽松推进'}
            </span>
          </div>
          <p className="text-secondary">{policySummary}</p>
        </div>
        <div className="script-policy-meta">
          {policyItems.map((item) => (
            <span key={item} className="action-guidance-chip">{item}</span>
          ))}
        </div>
        <div className="script-policy-actions">
          {currentProject && (
            <button className="btn btn-sm btn-primary" onClick={() => setQuickSettingsOpen(true)}>
              快速调整
            </button>
          )}
          {currentProject && (
            <button className="btn btn-sm" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings', 'tab=flow'))}>
              调整流程参数
            </button>
          )}
          {currentProject && (
            <button className="btn btn-sm" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings', 'tab=automation'))}>
              查看自动化
            </button>
          )}
          {currentProject && (
            <button className="btn btn-sm" onClick={() => navigate(buildProjectRoute(currentProject.id, 'settings', 'tab=delivery'))}>
              查看交付默认
            </button>
          )}
        </div>
      </div>

      <div className="script-workspace-layout">
        <section className="script-workspace-main">
          <AdaptScriptPage embedded />
        </section>
        <aside className={`script-workspace-side ${issueFocused ? 'is-focused' : ''}`}>
          <ReviewPage embedded variant="writing_panel" focusEpisode={currentEpisode} />
        </aside>
      </div>

      {currentProject && (
        <ScriptQuickSettingsDrawer
          project={currentProject}
          open={quickSettingsOpen}
          saving={quickSettingsSaving}
          onClose={() => setQuickSettingsOpen(false)}
          onSave={handleSaveQuickSettings}
        />
      )}
    </div>
  )
}
