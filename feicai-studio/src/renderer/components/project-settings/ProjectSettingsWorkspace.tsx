import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import OperationStatusBanner from '@renderer/components/layout/OperationStatusBanner'
import SectionTabs, { type SectionTabItem } from '@renderer/components/layout/SectionTabs'
import { useOperationFeedback } from '@renderer/hooks/useOperationFeedback'
import { buildProjectRoute } from '@renderer/project-routing'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { resolveProjectTaskSettings } from '@shared/project-task-settings'
import { validateProjectTaskAutomation } from '@shared/project-task-validation'
import {
  BUILTIN_EXPORT_PROFILES,
  BUILTIN_PROJECT_PRESETS,
  BUILTIN_TASK_TEMPLATES,
  buildProjectPresetConfig,
  resolveBuiltinProjectPreset
} from '@shared/template-catalog'
import type {
  PipelineSettings,
  PipelineStage,
  ProjectAutomationPreset,
  ProjectTaskAlertConfig,
  ProjectTaskDefaults,
  ProjectTaskSchedule,
  ProjectTaskTemplate,
  ReviewPolicyConfig
} from '@shared/types'
import {
  DEFAULT_PIPELINE_SETTINGS,
  DEFAULT_PROJECT_TASK_ALERTS,
  DEFAULT_PROJECT_TASK_DEFAULTS,
  DEFAULT_REVIEW_POLICY
} from '@shared/types'

type SettingsTab = 'overview' | 'flow' | 'automation' | 'delivery'

function resolveSettingsTab(value: string | null): SettingsTab {
  if (value === 'flow' || value === 'automation' || value === 'delivery') return value
  return 'overview'
}

function toLocalDateTimeInput(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function fromLocalDateTimeInput(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function parseEpisodeNumbers(value: string): number[] {
  return [...new Set(
    value
      .split(/[\s,，]+/)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)
  )].sort((a, b) => a - b)
}

function formatEpisodeNumbers(value: number[]): string {
  return value.join(', ')
}

function defaultTemplate(index: number): ProjectTaskTemplate {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `template-${Date.now()}-${index}`,
    label: `模板 ${index}`,
    source: 'project',
    priority: 'normal',
    maxAutoRetries: 1,
    batchMode: 'independent'
  }
}

function defaultSchedule(index: number): ProjectTaskSchedule {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `schedule-${Date.now()}-${index}`,
    label: `计划 ${index}`,
    enabled: true,
    episodeNumbers: [],
    frequency: 'daily',
    timeValue: '09:00'
  }
}

function createProjectTemplateCopy(template: ProjectTaskTemplate, index: number): ProjectTaskTemplate {
  return {
    ...template,
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `template-${Date.now()}-${index}`,
    label: `${template.label.replace(/^内置 · /, '')}（项目）`,
    source: 'project'
  }
}

function startStageLabel(value?: PipelineStage): string {
  if (value === 'director') return '导演分析'
  if (value === 'art') return '服化道'
  if (value === 'storyboard') return '分镜编写'
  return '全流程'
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

export default function ProjectSettingsWorkspace() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = resolveSettingsTab(searchParams.get('tab'))
  const { currentProject, saveProjectConfig, loadProject } = useProjectStore()
  const { addToast } = useToastStore()
  const operationFeedback = useOperationFeedback(addToast)
  const [ps, setPs] = useState<PipelineSettings>({ ...DEFAULT_PIPELINE_SETTINGS })
  const [projectName, setProjectName] = useState('')
  const [visualStyle, setVisualStyle] = useState('')
  const [targetMedium, setTargetMedium] = useState('')
  const [novelTitle, setNovelTitle] = useState('')
  const [novelGenre, setNovelGenre] = useState('')
  const [totalEpisodes, setTotalEpisodes] = useState('0')
  const [reviewPolicy, setReviewPolicy] = useState<ReviewPolicyConfig>({ ...DEFAULT_REVIEW_POLICY })
  const [taskDefaults, setTaskDefaults] = useState<ProjectTaskDefaults>({ ...DEFAULT_PROJECT_TASK_DEFAULTS })
  const [taskTemplates, setTaskTemplates] = useState<ProjectTaskTemplate[]>([])
  const [taskSchedules, setTaskSchedules] = useState<ProjectTaskSchedule[]>([])
  const [taskAlerts, setTaskAlerts] = useState<ProjectTaskAlertConfig>({ ...DEFAULT_PROJECT_TASK_ALERTS })
  const [templateProfileId, setTemplateProfileId] = useState('')
  const [exportProfileId, setExportProfileId] = useState('')
  const [flowMode, setFlowMode] = useState<'simple' | 'advanced'>('simple')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentProject) return
    setProjectName(currentProject.name)
    setVisualStyle(currentProject.visualStyle || '')
    setTargetMedium(currentProject.targetMedium || '')
    setNovelTitle(currentProject.novelTitle || '')
    setNovelGenre(currentProject.novelGenre || '')
    setTotalEpisodes(String(currentProject.totalEpisodes || 0))
    setPs({ ...DEFAULT_PIPELINE_SETTINGS, ...(currentProject.config.pipelineSettings || {}) })
    setReviewPolicy({ ...DEFAULT_REVIEW_POLICY, ...(currentProject.config.reviewPolicy || {}) })
    setTaskDefaults({ ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(currentProject.config.taskDefaults || {}) })
    setTaskTemplates(
      Array.isArray(currentProject.config.taskTemplates)
        ? currentProject.config.taskTemplates.map((template) => ({ ...template, source: template.source || 'project' }))
        : []
    )
    setTaskSchedules(Array.isArray(currentProject.config.taskSchedules) ? currentProject.config.taskSchedules : [])
    setTaskAlerts({ ...DEFAULT_PROJECT_TASK_ALERTS, ...(currentProject.config.taskAlerts || {}) })
    setTemplateProfileId(currentProject.config.templateProfileId || '')
    setExportProfileId(currentProject.config.exportProfileId || '')
  }, [currentProject?.id])

  const tabs = useMemo<SectionTabItem[]>(() => [
    { key: 'overview', label: '概览', hint: '项目快照与默认模板' },
    { key: 'flow', label: '流程参数', hint: '阈值与质检策略' },
    { key: 'automation', label: '自动化', hint: '任务模板与计划' },
    { key: 'delivery', label: '交付默认', hint: '导出模板与提醒' }
  ], [])

  const availableTaskTemplates = useMemo(
    () => resolveProjectTaskSettings({ taskDefaults, taskTemplates, taskSchedules, taskAlerts }).templates,
    [taskAlerts, taskDefaults, taskSchedules, taskTemplates]
  )
  const selectedProjectPreset = useMemo(
    () => BUILTIN_PROJECT_PRESETS.find((preset) => preset.id === templateProfileId) || null,
    [templateProfileId]
  )
  const selectedExportProfile = useMemo(
    () => BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === exportProfileId) || null,
    [exportProfileId]
  )
  const selectedPresetTemplates = useMemo(
    () => selectedProjectPreset?.recommendedTemplateIds
      ?.map((templateId) => BUILTIN_TASK_TEMPLATES.find((template) => template.id === templateId) || null)
      .filter((template): template is ProjectTaskTemplate => !!template) || [],
    [selectedProjectPreset]
  )
  const normalizedTotalEpisodes = useMemo(
    () => Math.max(0, Number.parseInt(totalEpisodes || '0', 10) || 0),
    [totalEpisodes]
  )
  const taskValidationIssues = useMemo(
    () => currentProject
      ? validateProjectTaskAutomation(
          { taskTemplates, taskSchedules, taskAlerts },
          normalizedTotalEpisodes
        )
      : [],
    [currentProject, normalizedTotalEpisodes, taskAlerts, taskSchedules, taskTemplates]
  )
  const baselineSnapshot = useMemo(() => {
    if (!currentProject) return ''
    return stableStringify({
      projectName: currentProject.name,
      totalEpisodes: currentProject.totalEpisodes || 0,
      visualStyle: currentProject.visualStyle || '',
      targetMedium: currentProject.targetMedium || '',
      novelTitle: currentProject.novelTitle || '',
      novelGenre: currentProject.novelGenre || '',
      pipelineSettings: { ...DEFAULT_PIPELINE_SETTINGS, ...(currentProject.config.pipelineSettings || {}) },
      reviewPolicy: { ...DEFAULT_REVIEW_POLICY, ...(currentProject.config.reviewPolicy || {}) },
      taskDefaults: { ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(currentProject.config.taskDefaults || {}) },
      taskTemplates: Array.isArray(currentProject.config.taskTemplates)
        ? currentProject.config.taskTemplates.map((template) => ({ ...template, source: template.source || 'project' }))
        : [],
      taskSchedules: Array.isArray(currentProject.config.taskSchedules) ? currentProject.config.taskSchedules : [],
      taskAlerts: { ...DEFAULT_PROJECT_TASK_ALERTS, ...(currentProject.config.taskAlerts || {}) },
      templateProfileId: currentProject.config.templateProfileId || '',
      exportProfileId: currentProject.config.exportProfileId || ''
    })
  }, [currentProject])
  const draftSnapshot = useMemo(
    () => stableStringify({
      projectName,
      totalEpisodes: normalizedTotalEpisodes,
      visualStyle,
      targetMedium,
      novelTitle,
      novelGenre,
      pipelineSettings: ps,
      reviewPolicy,
      taskDefaults,
      taskTemplates,
      taskSchedules,
      taskAlerts,
      templateProfileId,
      exportProfileId
    }),
    [
      exportProfileId,
      normalizedTotalEpisodes,
      novelGenre,
      novelTitle,
      projectName,
      ps,
      reviewPolicy,
      targetMedium,
      taskAlerts,
      taskDefaults,
      taskSchedules,
      taskTemplates,
      templateProfileId,
      visualStyle
    ]
  )
  const isDirty = baselineSnapshot !== '' && baselineSnapshot !== draftSnapshot
  const episodeDelta = currentProject ? normalizedTotalEpisodes - currentProject.totalEpisodes : 0
  const advancedFlowChanged = currentProject
    ? ps.maxRetries !== (currentProject.config.pipelineSettings?.maxRetries ?? DEFAULT_PIPELINE_SETTINGS.maxRetries)
      || ps.llmTimeoutSec !== (currentProject.config.pipelineSettings?.llmTimeoutSec ?? DEFAULT_PIPELINE_SETTINGS.llmTimeoutSec)
    : false
  const changeHighlights = [
    episodeDelta !== 0 ? `总集数${episodeDelta > 0 ? `增加 ${episodeDelta}` : `减少 ${Math.abs(episodeDelta)}`}` : null,
    projectName.trim() !== currentProject?.name ? '项目名称已修改' : null,
    visualStyle.trim() !== (currentProject?.visualStyle || '') ? '视觉风格已修改' : null,
    targetMedium.trim() !== (currentProject?.targetMedium || '') ? '目标媒介已修改' : null,
    templateProfileId !== (currentProject?.config.templateProfileId || '') ? '项目预设已调整' : null,
    exportProfileId !== (currentProject?.config.exportProfileId || '') ? '默认导出模板已调整' : null,
    advancedFlowChanged ? '高级流程参数已调整' : null
  ].filter((item): item is string => !!item)

  if (!currentProject) return null

  const handleSaveSettings = async () => {
    if (normalizedTotalEpisodes <= 0) {
      operationFeedback.fail('save-settings', '保存失败', '总集数必须大于 0。')
      return
    }

    const issues = validateProjectTaskAutomation(
      { taskTemplates, taskSchedules, taskAlerts },
      normalizedTotalEpisodes
    )
    const blockingIssues = issues.filter((issue) => issue.severity === 'error')
    if (blockingIssues.length > 0) {
      operationFeedback.fail('save-settings', '保存失败', blockingIssues[0]?.message || '任务自动化配置存在错误，请先修正')
      return
    }
    const warningIssues = issues.filter((issue) => issue.severity === 'warning')

    setSaving(true)
    operationFeedback.start('save-settings', '正在保存项目配置', '正在写入项目设置并刷新当前项目快照。')
    try {
      await saveProjectConfig(
        currentProject.projectPath,
        {
          projectName: projectName.trim() || currentProject.name,
          totalEpisodes: normalizedTotalEpisodes,
          visualStyle: visualStyle.trim(),
          targetMedium: targetMedium.trim(),
          ...(currentProject.sourceType === 'novel'
            ? {
                novelTitle: novelTitle.trim() || undefined,
                novelGenre: novelGenre.trim() || undefined
              }
            : {}),
          pipelineSettings: ps,
          reviewPolicy,
          taskDefaults,
          taskTemplates: taskTemplates.filter((template) => template.source !== 'builtin'),
          taskSchedules,
          taskAlerts,
          templateProfileId: templateProfileId || undefined,
          exportProfileId: exportProfileId || undefined
        }
      )
      if (warningIssues.length > 0) {
        operationFeedback.warn('save-settings', '项目配置已保存', `已保存，但仍有 ${warningIssues.length} 条自动化提醒待关注`)
      } else {
        operationFeedback.succeed('save-settings', '项目配置已保存', '参数已更新，并已刷新当前项目快照。')
      }
      if (useProjectStore.getState().currentProject?.id === currentProject.id) {
        await loadProject(currentProject.id)
      }
    } catch (error) {
      operationFeedback.fail('save-settings', '保存失败', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleResetSettings = () => {
    setPs({ ...DEFAULT_PIPELINE_SETTINGS })
    setProjectName(currentProject.name)
    setVisualStyle(currentProject.visualStyle || '')
    setTargetMedium(currentProject.targetMedium || '')
    setNovelTitle(currentProject.novelTitle || '')
    setNovelGenre(currentProject.novelGenre || '')
    setTotalEpisodes(String(currentProject.totalEpisodes || 0))
    setReviewPolicy({ ...DEFAULT_REVIEW_POLICY })
    setTaskDefaults({ ...DEFAULT_PROJECT_TASK_DEFAULTS })
    setTaskTemplates([])
    setTaskSchedules([])
    setTaskAlerts({ ...DEFAULT_PROJECT_TASK_ALERTS })
    setTemplateProfileId('')
    setExportProfileId('')
    operationFeedback.publish({
      action: 'reset-settings',
      tone: 'info',
      title: '已恢复默认值',
      message: '当前表单已重置，保存后才会真正写入项目配置。',
      toast: true
    })
  }

  const updateTemplate = (templateId: string, patch: Partial<ProjectTaskTemplate>) => {
    setTaskTemplates((prev) => prev.map((item) => item.id === templateId ? { ...item, ...patch } : item))
  }

  const removeTemplate = (templateId: string) => {
    setTaskTemplates((prev) => prev.filter((item) => item.id !== templateId))
    setTaskSchedules((prev) => prev.map((item) => item.templateId === templateId ? { ...item, templateId: undefined } : item))
  }

  const addTemplate = () => {
    setTaskTemplates((prev) => [...prev, defaultTemplate(prev.length + 1)])
  }

  const copyBuiltinTemplate = (template: ProjectTaskTemplate) => {
    setTaskTemplates((prev) => [...prev, createProjectTemplateCopy(template, prev.length + 1)])
    operationFeedback.publish({
      action: 'template-copy',
      tone: 'success',
      title: '模板已复制',
      message: `已复制模板「${template.label}」到项目配置。`,
      toast: true
    })
  }

  const copyPresetTemplates = (preset: ProjectAutomationPreset | null) => {
    if (!preset) return
    const recommendedTemplates = (preset.recommendedTemplateIds || [])
      .map((templateId) => BUILTIN_TASK_TEMPLATES.find((template) => template.id === templateId) || null)
      .filter((template): template is ProjectTaskTemplate => !!template)

    if (recommendedTemplates.length === 0) {
      operationFeedback.publish({
        action: 'preset-copy',
        tone: 'info',
        title: '没有可复制的推荐模板',
        message: '该预设没有推荐任务模板。',
        toast: true
      })
      return
    }

    setTaskTemplates((prev) => [
      ...prev,
      ...recommendedTemplates.map((template, index) => createProjectTemplateCopy(template, prev.length + index + 1))
    ])
    operationFeedback.publish({
      action: 'preset-copy',
      tone: 'success',
      title: '推荐模板已复制',
      message: `已复制 ${recommendedTemplates.length} 个推荐模板到项目配置。`,
      toast: true
    })
  }

  const updateSchedule = (scheduleId: string, patch: Partial<ProjectTaskSchedule>) => {
    setTaskSchedules((prev) => prev.map((item) => item.id === scheduleId ? { ...item, ...patch } : item))
  }

  const removeSchedule = (scheduleId: string) => {
    setTaskSchedules((prev) => prev.filter((item) => item.id !== scheduleId))
  }

  const addSchedule = () => {
    setTaskSchedules((prev) => [...prev, defaultSchedule(prev.length + 1)])
  }

  const applyProjectPreset = (preset: ProjectAutomationPreset | null) => {
    if (!preset) return
    const presetConfig = buildProjectPresetConfig(preset)
    setPs({ ...DEFAULT_PIPELINE_SETTINGS, ...(presetConfig.pipelineSettings || {}) })
    setReviewPolicy({ ...DEFAULT_REVIEW_POLICY, ...(presetConfig.reviewPolicy || {}) })
    setTaskDefaults({ ...DEFAULT_PROJECT_TASK_DEFAULTS, ...(presetConfig.taskDefaults || {}) })
    if (presetConfig.exportProfileId) {
      setExportProfileId(presetConfig.exportProfileId)
    }
    setTemplateProfileId(presetConfig.templateProfileId || preset.id)
    operationFeedback.publish({
      action: 'apply-preset',
      tone: 'success',
      title: '项目预设已套用',
      message: `已套用项目预设「${preset.label}」，相关默认策略已同步到当前表单。`,
      toast: true
    })
  }

  return (
    <div className="project-settings-page">
      <div className="card project-settings-header">
        <div className="project-settings-copy">
          <h1>项目设置</h1>
          <p className="text-secondary">
            把项目级参数、审核策略、自动化模板、调度计划和导出默认值收回到一个稳定入口，避免关键能力继续散落在旧页面里。
          </p>
          <SectionTabs
            tabs={tabs}
            activeKey={activeTab}
            onChange={(key) => setSearchParams({ tab: key })}
          />
        </div>
        <div className="project-settings-header-actions">
          <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'workspace'))}>
            返回工作台
          </button>
          <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving || !isDirty}>
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      <OperationStatusBanner feedback={operationFeedback.feedback} onDismiss={operationFeedback.clear} />

      <div className={`card project-settings-status-card ${isDirty ? 'is-dirty' : ''}`}>
        <div className="project-settings-status-main">
          <strong>{isDirty ? '有未保存修改' : '当前修改已同步'}</strong>
          <span className="text-secondary">
            {isDirty
              ? '建议在离开页面前保存，避免项目参数、自动化策略和导出默认值出现认知偏差。'
              : '当前页面内容与项目快照一致。'}
          </span>
        </div>
        <div className="project-settings-status-actions">
          <button className="btn" onClick={handleResetSettings} disabled={!isDirty}>
            放弃修改
          </button>
          <button className="btn btn-primary" onClick={handleSaveSettings} disabled={!isDirty || saving}>
            {saving ? '保存中...' : '保存当前修改'}
          </button>
        </div>
      </div>

      {changeHighlights.length > 0 && (
        <div className="card project-settings-change-card">
          <div className="project-settings-section-head">
            <h3>本次修改摘要</h3>
            <span className="text-secondary text-xs">{changeHighlights.length} 项变更</span>
          </div>
          <div className="project-settings-chip-list">
            {changeHighlights.map((item) => (
              <span key={item} className="project-settings-change-chip">{item}</span>
            ))}
          </div>
        </div>
      )}

      <div className="project-settings-summary-grid">
        <div className="card project-settings-summary-card">
          <span className="project-settings-label">项目阶段</span>
          <strong>{currentProject.phase === 'production' ? '画面制作 / 交付阶段' : '内容准备 / 剧本创作阶段'}</strong>
        </div>
        <div className="card project-settings-summary-card">
          <span className="project-settings-label">项目类型</span>
          <strong>{currentProject.sourceType === 'novel' ? '小说改编' : currentProject.sourceType === 'script' ? '脚本导入' : '原创项目'}</strong>
        </div>
        <div className="card project-settings-summary-card">
          <span className="project-settings-label">总集数</span>
          <strong>{Math.max(0, Number.parseInt(totalEpisodes || '0', 10) || 0) || '—'}</strong>
        </div>
        <div className="card project-settings-summary-card">
          <span className="project-settings-label">默认导出模板</span>
          <strong>{selectedExportProfile?.label || '未设置'}</strong>
        </div>
      </div>

      {(activeTab === 'overview' || activeTab === 'flow') && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>基础信息</h3>
            <span className="text-secondary text-xs">这里调整项目识别信息和显示用元数据，不直接改变执行阶段流转。</span>
          </div>
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>项目名称</label>
              <input className="input input-sm" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </div>
            <div className="ps-item">
              <label>视觉风格</label>
              <input className="input input-sm" value={visualStyle} onChange={(event) => setVisualStyle(event.target.value)} placeholder="例如：写实、赛璐璐、国风" />
            </div>
            <div className="ps-item">
              <label>目标媒介</label>
              <input className="input input-sm" value={targetMedium} onChange={(event) => setTargetMedium(event.target.value)} placeholder="例如：短剧、分镜、漫画" />
            </div>
            {currentProject.sourceType === 'novel' && (
              <>
                <div className="ps-item">
                  <label>小说标题</label>
                  <input className="input input-sm" value={novelTitle} onChange={(event) => setNovelTitle(event.target.value)} />
                </div>
                <div className="ps-item">
                  <label>小说题材</label>
                  <input className="input input-sm" value={novelGenre} onChange={(event) => setNovelGenre(event.target.value)} placeholder="例如：古言、现言、悬疑" />
                </div>
              </>
            )}
            <div className="ps-item">
              <label>总集数</label>
              <input
                type="number"
                min={1}
                className="input input-sm"
                value={totalEpisodes}
                onChange={(event) => setTotalEpisodes(event.target.value)}
              />
              <span className="ps-desc text-secondary">保存后会同步刷新项目快照与分集记录。</span>
              {episodeDelta !== 0 && (
                <div className={`project-settings-inline-hint ${episodeDelta > 0 ? 'tone-info' : 'tone-warning'}`}>
                  {episodeDelta > 0
                    ? `将新增 ${episodeDelta} 个分集占位记录，方便后续继续推进。`
                    : `将把项目总集数回收到 ${normalizedTotalEpisodes}，请确认现有分集节奏已梳理完成。`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'flow') && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>流程参数</h3>
            <div className="project-settings-header-inline">
              <span className="text-secondary text-xs">普通模式先展示最常用的阈值；高级模式再展开执行边界。</span>
              <div className="project-settings-mode-switch">
                <button className={`btn btn-sm ${flowMode === 'simple' ? 'btn-primary' : ''}`} onClick={() => setFlowMode('simple')}>
                  普通模式
                </button>
                <button className={`btn btn-sm ${flowMode === 'advanced' ? 'btn-primary' : ''}`} onClick={() => setFlowMode('advanced')}>
                  高级模式
                </button>
              </div>
            </div>
          </div>
          {flowMode === 'advanced' && (
            <div className="project-settings-risk-banner tone-warning">
              高级模式会影响重试策略和执行等待边界。只有在你明确知道项目执行瓶颈时才建议调整。
            </div>
          )}
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>审核通过阈值</label>
              <span className="ps-desc text-secondary">评分达到该值即通过</span>
              <input type="number" className="input input-sm" min={1} max={10} value={ps.passScore} onChange={(e) => setPs({ ...ps, passScore: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>每集最短时长</label>
              <span className="ps-desc text-secondary">生成提示词的最短总时长约束</span>
              <input type="number" className="input input-sm" min={30} max={600} value={ps.durationMin} onChange={(e) => setPs({ ...ps, durationMin: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>每集最长时长</label>
              <span className="ps-desc text-secondary">生成提示词的最长总时长约束</span>
              <input type="number" className="input input-sm" min={30} max={600} value={ps.durationMax} onChange={(e) => setPs({ ...ps, durationMax: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>单条提示词上限</label>
              <span className="ps-desc text-secondary">每条提示词允许的最长时长</span>
              <input type="number" className="input input-sm" min={4} max={15} value={ps.singlePromptMax} onChange={(e) => setPs({ ...ps, singlePromptMax: Number(e.target.value) })} />
            </div>
            {flowMode === 'advanced' && (
              <>
                <div className="ps-item">
                  <label>最大重试次数</label>
                  <span className="ps-desc text-secondary">审核不通过时的自动重试上限</span>
                  <input type="number" className="input input-sm" min={1} max={10} value={ps.maxRetries} onChange={(e) => setPs({ ...ps, maxRetries: Number(e.target.value) })} />
                </div>
                <div className="ps-item">
                  <label>LLM 超时</label>
                  <span className="ps-desc text-secondary">无新数据超过该秒数则中断</span>
                  <input type="number" className="input input-sm" min={30} max={300} value={ps.llmTimeoutSec} onChange={(e) => setPs({ ...ps, llmTimeoutSec: Number(e.target.value) })} />
                </div>
              </>
            )}
          </div>

          <div className="pipeline-settings-header">
            <h3>质检策略</h3>
            <span className="text-secondary text-xs">针对编剧阶段的自动修正上限。</span>
          </div>
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>拆解自动修正轮数</label>
              <span className="ps-desc text-secondary">拆解 FAIL 后最多自动修正次数</span>
              <input type="number" className="input input-sm" min={0} max={5} value={reviewPolicy.breakdownAutoRepairRounds ?? 0} onChange={(e) => setReviewPolicy({ ...reviewPolicy, breakdownAutoRepairRounds: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>剧本自动修正轮数</label>
              <span className="ps-desc text-secondary">剧本 FAIL 后最多自动修正次数</span>
              <input type="number" className="input input-sm" min={0} max={5} value={reviewPolicy.scriptAutoRepairRounds ?? 0} onChange={(e) => setReviewPolicy({ ...reviewPolicy, scriptAutoRepairRounds: Number(e.target.value) })} />
            </div>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'delivery') && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>模板与交付默认</h3>
            <span className="text-secondary text-xs">项目预设负责批量套用，导出模板负责交付默认值。</span>
          </div>
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>项目预设</label>
              <span className="ps-desc text-secondary">统一覆盖默认重试、审核策略和推荐导出模板</span>
              <select className="input input-sm" value={templateProfileId} onChange={(event) => setTemplateProfileId(event.target.value)}>
                <option value="">不使用预设</option>
                {BUILTIN_PROJECT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
              {selectedProjectPreset && <div className="template-preset-desc text-secondary">{selectedProjectPreset.description}</div>}
              {selectedPresetTemplates.length > 0 && (
                <div className="builtin-template-meta text-secondary">
                  {selectedPresetTemplates.map((template) => <span key={template.id}>{template.label}</span>)}
                </div>
              )}
              <div className="project-preset-actions">
                <button className="btn btn-sm" onClick={() => applyProjectPreset(resolveBuiltinProjectPreset(templateProfileId))} disabled={!templateProfileId}>
                  套用预设
                </button>
                <button className="btn btn-sm" onClick={() => copyPresetTemplates(selectedProjectPreset)} disabled={selectedPresetTemplates.length === 0}>
                  复制推荐模板
                </button>
              </div>
            </div>
            <div className="ps-item">
              <label>默认导出模板</label>
              <span className="ps-desc text-secondary">交付页会默认选中这个模板</span>
              <select className="input input-sm" value={exportProfileId} onChange={(event) => setExportProfileId(event.target.value)}>
                <option value="">无默认模板</option>
                {BUILTIN_EXPORT_PROFILES.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
              {selectedExportProfile?.description && <div className="template-preset-desc text-secondary">{selectedExportProfile.description}</div>}
            </div>
          </div>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'automation') && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>任务编排默认策略</h3>
            <span className="text-secondary text-xs">批量执行和自动化计划会优先读取这里的默认值。</span>
          </div>
          <div className="pipeline-settings-grid">
            <div className="ps-item">
              <label>默认优先级</label>
              <select className="input input-sm" value={taskDefaults.defaultPriority} onChange={(e) => setTaskDefaults({ ...taskDefaults, defaultPriority: e.target.value as ProjectTaskDefaults['defaultPriority'] })}>
                <option value="high">高优先级</option>
                <option value="normal">标准优先级</option>
                <option value="low">低优先级</option>
              </select>
            </div>
            <div className="ps-item">
              <label>默认自动重试次数</label>
              <input type="number" className="input input-sm" min={0} max={3} value={taskDefaults.defaultMaxAutoRetries} onChange={(e) => setTaskDefaults({ ...taskDefaults, defaultMaxAutoRetries: Number(e.target.value) })} />
            </div>
            <div className="ps-item">
              <label>默认批次编排模式</label>
              <select className="input input-sm" value={taskDefaults.defaultBatchMode} onChange={(e) => setTaskDefaults({ ...taskDefaults, defaultBatchMode: e.target.value as ProjectTaskDefaults['defaultBatchMode'] })}>
                <option value="independent">独立并排队</option>
                <option value="sequential_on_success">串行，前一集成功后继续</option>
                <option value="sequential_always">串行，无论成功失败都继续</option>
              </select>
            </div>
            <div className="ps-item">
              <label>默认归档天数</label>
              <input type="number" className="input input-sm" min={1} max={90} value={taskDefaults.archiveAfterDays} onChange={(e) => setTaskDefaults({ ...taskDefaults, archiveAfterDays: Number(e.target.value) })} />
            </div>
          </div>

          <div className="pipeline-settings-header">
            <h3>内置任务模板库</h3>
            <span className="text-secondary text-xs">内置模板可直接复用，需要定制时再复制为项目模板。</span>
          </div>
          <div className="pipeline-dynamic-list">
            {BUILTIN_TASK_TEMPLATES.map((template) => (
              <div key={template.id} className="pipeline-dynamic-card builtin-template-card">
                <div className="pipeline-dynamic-card-header">
                  <strong>{template.label}</strong>
                  <button className="btn btn-sm" onClick={() => copyBuiltinTemplate(template)}>复制到项目</button>
                </div>
                <div className="template-preset-desc text-secondary">{template.description}</div>
                <div className="builtin-template-meta text-secondary">
                  <span>{startStageLabel(template.startStage)}</span>
                  <span>{template.batchMode}</span>
                  <span>{template.priority}</span>
                  <span>重试 {template.maxAutoRetries}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pipeline-settings-header">
            <h3>项目任务模板</h3>
            <button className="btn btn-sm" onClick={addTemplate}>新增模板</button>
          </div>
          {taskTemplates.length === 0 ? (
            <div className="pipeline-empty-block text-secondary">
              尚未配置项目任务模板。这里用于沉淀批量运行和计划任务的项目内默认策略。
            </div>
          ) : (
            <div className="pipeline-dynamic-list">
              {taskTemplates.map((template) => (
                <div key={template.id} className="pipeline-dynamic-card">
                  <div className="pipeline-dynamic-card-header">
                    <strong>{template.label}</strong>
                    <button className="btn btn-sm" onClick={() => removeTemplate(template.id)}>删除</button>
                  </div>
                  <div className="pipeline-settings-grid pipeline-settings-grid-wide">
                    <div className="ps-item">
                      <label>模板名称</label>
                      <input className="input input-sm" value={template.label} onChange={(event) => updateTemplate(template.id, { label: event.target.value })} />
                    </div>
                    <div className="ps-item">
                      <label>起始阶段</label>
                      <select className="input input-sm" value={template.startStage || ''} onChange={(event) => updateTemplate(template.id, { startStage: (event.target.value || undefined) as PipelineStage | undefined, singleStage: event.target.value ? template.singleStage : false })}>
                        <option value="">全流程</option>
                        <option value="director">导演分析</option>
                        <option value="art">服化道</option>
                        <option value="storyboard">分镜编写</option>
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>阶段执行模式</label>
                      <select className="input input-sm" value={template.startStage ? (template.singleStage ? 'single' : 'continue') : 'full'} onChange={(event) => updateTemplate(template.id, { singleStage: event.target.value === 'single' })} disabled={!template.startStage}>
                        <option value="full">全流程</option>
                        <option value="single">仅执行该阶段</option>
                        <option value="continue">从该阶段继续到结束</option>
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>优先级</label>
                      <select className="input input-sm" value={template.priority} onChange={(event) => updateTemplate(template.id, { priority: event.target.value as ProjectTaskTemplate['priority'] })}>
                        <option value="high">高优先级</option>
                        <option value="normal">标准优先级</option>
                        <option value="low">低优先级</option>
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>自动重试</label>
                      <input type="number" className="input input-sm" min={0} max={3} value={template.maxAutoRetries} onChange={(event) => updateTemplate(template.id, { maxAutoRetries: Number(event.target.value) })} />
                    </div>
                    <div className="ps-item">
                      <label>批次编排</label>
                      <select className="input input-sm" value={template.batchMode} onChange={(event) => updateTemplate(template.id, { batchMode: event.target.value as ProjectTaskTemplate['batchMode'] })}>
                        <option value="independent">独立并排队</option>
                        <option value="sequential_on_success">串行，前一集成功后继续</option>
                        <option value="sequential_always">串行，无论成功失败都继续</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pipeline-settings-header">
            <h3>自动化计划</h3>
            <button className="btn btn-sm" onClick={addSchedule}>新增计划</button>
          </div>
          {taskSchedules.length === 0 ? (
            <div className="pipeline-empty-block text-secondary">
              尚未配置自动化计划。计划可绑定模板，按一次性时间或每日时刻自动入队。
            </div>
          ) : (
            <div className="pipeline-dynamic-list">
              {taskSchedules.map((schedule) => (
                <div key={schedule.id} className="pipeline-dynamic-card">
                  <div className="pipeline-dynamic-card-header">
                    <strong>{schedule.label}</strong>
                    <button className="btn btn-sm" onClick={() => removeSchedule(schedule.id)}>删除</button>
                  </div>
                  <div className="pipeline-settings-grid pipeline-settings-grid-wide">
                    <div className="ps-item">
                      <label>计划名称</label>
                      <input className="input input-sm" value={schedule.label} onChange={(event) => updateSchedule(schedule.id, { label: event.target.value })} />
                    </div>
                    <div className="ps-item">
                      <label>启用状态</label>
                      <select className="input input-sm" value={schedule.enabled ? 'enabled' : 'disabled'} onChange={(event) => updateSchedule(schedule.id, { enabled: event.target.value === 'enabled' })}>
                        <option value="enabled">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>任务模板</label>
                      <select className="input input-sm" value={schedule.templateId || ''} onChange={(event) => updateSchedule(schedule.id, { templateId: event.target.value || undefined })}>
                        <option value="">不使用模板（走默认策略）</option>
                        {availableTaskTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            [{template.source === 'builtin' ? '内置' : '项目'}] {template.label} · {startStageLabel(template.startStage)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>触发频率</label>
                      <select className="input input-sm" value={schedule.frequency} onChange={(event) => updateSchedule(schedule.id, { frequency: event.target.value as ProjectTaskSchedule['frequency'], timeValue: event.target.value === 'daily' ? (schedule.timeValue.includes('T') ? '09:00' : schedule.timeValue || '09:00') : (schedule.timeValue.includes('T') ? schedule.timeValue : '') })}>
                        <option value="daily">每日</option>
                        <option value="once">一次性</option>
                      </select>
                    </div>
                    <div className="ps-item">
                      <label>{schedule.frequency === 'daily' ? '触发时刻' : '触发时间'}</label>
                      <input className="input input-sm" type={schedule.frequency === 'daily' ? 'time' : 'datetime-local'} value={schedule.frequency === 'daily' ? schedule.timeValue : toLocalDateTimeInput(schedule.timeValue)} onChange={(event) => updateSchedule(schedule.id, { timeValue: schedule.frequency === 'daily' ? event.target.value : fromLocalDateTimeInput(event.target.value) })} />
                    </div>
                    <div className="ps-item">
                      <label>集数列表</label>
                      <input className="input input-sm" value={formatEpisodeNumbers(schedule.episodeNumbers)} placeholder="例如：1, 2, 3" onChange={(event) => updateSchedule(schedule.id, { episodeNumbers: parseEpisodeNumbers(event.target.value) })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'automation' || activeTab === 'delivery') && (
        <div className="card pipeline-settings-panel">
          <div className="pipeline-settings-header">
            <h3>自动化告警</h3>
            <span className="text-secondary text-xs">调度触发与最终失败都在这里控制提醒方式。</span>
          </div>
          <div className="pipeline-settings-grid">
            <label className="task-checkbox">
              <input type="checkbox" checked={taskAlerts.notifyOnScheduleTriggered} onChange={(event) => setTaskAlerts({ ...taskAlerts, notifyOnScheduleTriggered: event.target.checked })} />
              <span>调度触发时提醒</span>
            </label>
            <label className="task-checkbox">
              <input type="checkbox" checked={taskAlerts.notifyOnRunFailed} onChange={(event) => setTaskAlerts({ ...taskAlerts, notifyOnRunFailed: event.target.checked })} />
              <span>任务最终失败时提醒</span>
            </label>
            <label className="task-checkbox">
              <input type="checkbox" checked={taskAlerts.toastNotifications} onChange={(event) => setTaskAlerts({ ...taskAlerts, toastNotifications: event.target.checked })} />
              <span>站内 Toast</span>
            </label>
            <label className="task-checkbox">
              <input type="checkbox" checked={taskAlerts.desktopNotifications} onChange={(event) => setTaskAlerts({ ...taskAlerts, desktopNotifications: event.target.checked })} />
              <span>桌面通知</span>
            </label>
          </div>

          {taskValidationIssues.length > 0 && (
            <div className="pipeline-validation-list">
              {taskValidationIssues.map((issue, index) => (
                <div key={`${issue.scope}-${issue.field}-${issue.id || index}`} className={`pipeline-validation-item is-${issue.severity}`}>
                  <strong>{issue.severity === 'error' ? '错误' : '提醒'}</strong>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="project-settings-actions">
            <button className="btn" onClick={() => navigate(buildProjectRoute(currentProject.id, 'delivery'))}>
              打开交付导出
            </button>
            <button className="btn" onClick={handleResetSettings}>恢复默认</button>
            <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving}>
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
