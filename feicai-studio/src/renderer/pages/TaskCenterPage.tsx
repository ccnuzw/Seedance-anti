import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import { useOperationFeedback } from '@renderer/hooks/useOperationFeedback'
import { platformAPI } from '@renderer/platform/api'
import { resolveProjectTaskSettings } from '@shared/project-task-settings'
import { validateProjectTaskAutomation } from '@shared/project-task-validation'
import { resolveBuiltinExportProfile, resolveBuiltinProjectPreset } from '@shared/template-catalog'
import type {
  LogEntry,
  PipelineLLMCallRecord,
  PipelineRunDetail,
  PipelineRunPriority,
  PipelineRunRecord,
  PipelineRuntimeDiagnostics,
  PipelineRunStatus,
  PipelineStage
} from '@shared/types'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import {
  buildAutomationAuditReport,
  buildAutomationAuditFileName,
  buildAutomationReportOutputPath,
  buildDiagnosticsSnapshotFileName,
  buildPipelineClosureFileName,
  buildPipelineClosureReport,
  pickLatestPipelineRuns,
  summarizePipelineRuns,
  serializeDiagnosticsSnapshot
} from './task-center-reporting'
import {
  formatTelemetryDurationMs,
  formatTelemetryTokens,
  formatTelemetryUsd
} from './pipeline-telemetry-format'
import OperationStatusBanner from '@renderer/components/layout/OperationStatusBanner'
import EmptyState from '@renderer/components/layout/EmptyState'
import './TaskCenterPage.css'

type StatusFilter = 'all' | PipelineRunStatus
type StageFilter = 'all' | PipelineStage
type PriorityFilter = 'all' | PipelineRunPriority

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '进行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'aborted', label: '已中止' },
  { value: 'dead_letter', label: '死信' }
]

const STAGE_OPTIONS: Array<{ value: StageFilter; label: string }> = [
  { value: 'all', label: '全部阶段' },
  { value: 'director', label: '导演分析' },
  { value: 'art', label: '服化道' },
  { value: 'storyboard', label: '分镜编写' }
]

const PRIORITY_OPTIONS: Array<{ value: PriorityFilter; label: string }> = [
  { value: 'all', label: '全部优先级' },
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '标准优先级' },
  { value: 'low', label: '低优先级' }
]

function formatRunStatus(status: PipelineRunStatus): string {
  return {
    queued: '排队中',
    running: '进行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    aborted: '已中止',
    dead_letter: '死信'
  }[status]
}

function formatRunStage(stage: PipelineStage): string {
  return {
    director: '导演分析',
    art: '服化道',
    storyboard: '分镜编写'
  }[stage]
}

function formatRunPriority(priority: PipelineRunPriority): string {
  return {
    high: '高优先级',
    normal: '标准优先级',
    low: '低优先级'
  }[priority]
}

function formatRunTime(value?: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatRunDuration(run: PipelineRunRecord): string {
  if (!run.startedAt || !run.endedAt) return '--'
  const start = new Date(run.startedAt).getTime()
  const end = new Date(run.endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '--'
  const totalSec = Math.round((end - start) / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function formatFailureClass(value?: string): string {
  return {
    timeout: '超时',
    network: '网络',
    rate_limit: '限流',
    provider: '服务端',
    auth: '鉴权',
    validation: '请求参数',
    unknown: '未知'
  }[value || 'unknown'] || value || '--'
}

function getLogIcon(level: string, eventType: string): string {
  if (eventType === 'state_changed') return '🔄'
  if (eventType === 'skill_loading') return '📦'
  if (eventType === 'llm_calling') return '🤖'
  if (eventType === 'llm_complete') return '✨'
  if (eventType === 'file_written') return '💾'
  if (eventType === 'review_start') return '⚠️'
  if (eventType === 'stage_complete') return '✅'
  if (eventType === 'review_fail') return '❌'
  if (eventType === 'paused') return '⏸'
  if (eventType === 'resumed') return '▶'
  if (level === 'error') return '🔴'
  if (level === 'warn') return '🟡'
  return '📝'
}

function isCancelable(status: PipelineRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused'
}

function isRetryable(status: PipelineRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted' || status === 'dead_letter'
}

export default function TaskCenterPage() {
  const navigate = useNavigate()
  const { projects, loadProjects, setCurrentProject, loadProject } = useProjectStore()
  const { addToast } = useToastStore()
  const operationFeedback = useOperationFeedback(addToast)
  const [runs, setRuns] = useState<PipelineRunRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [archiveDays, setArchiveDays] = useState(7)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunDetail, setSelectedRunDetail] = useState<PipelineRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [diagnostics, setDiagnostics] = useState<PipelineRuntimeDiagnostics | null>(null)
  const isWebPreview = platformAPI.isWebPreview
  const hasRemoteRuntime = platformAPI.capabilities.pipelineRuntime
  const supportsRuntimeOperations = !isWebPreview || hasRemoteRuntime

  const refreshRuns = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
    }
    try {
      const nextRuns = await platformAPI.invoke(IPC.PIPELINE_LIST_ALL_RUNS, 200, includeArchived) as PipelineRunRecord[]
      setRuns(nextRuns)
      return true
    } catch {
      if (!silent) {
        addToast('error', '全局任务列表加载失败')
      }
      return false
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [addToast, includeArchived])

  const refreshDiagnostics = useCallback(async (silent = false) => {
    try {
      const nextDiagnostics = await platformAPI.invoke(IPC.PIPELINE_GET_DIAGNOSTICS) as PipelineRuntimeDiagnostics
      setDiagnostics(nextDiagnostics)
      return true
    } catch {
      if (!silent) {
        addToast('error', '运行时诊断加载失败')
      }
      return false
    }
  }, [addToast])

  useEffect(() => {
    void loadProjects()
    void refreshRuns()
    void refreshDiagnostics()
    const timer = window.setInterval(() => {
      void refreshRuns(true)
      void refreshDiagnostics(true)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadProjects, refreshDiagnostics, refreshRuns])

  const filteredRuns = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      if (stageFilter !== 'all' && run.currentStage !== stageFilter) return false
      if (priorityFilter !== 'all' && run.priority !== priorityFilter) return false
      if (projectFilter !== 'all' && run.projectId !== projectFilter) return false
      if (!keyword) return true

      const haystack = [
        run.projectName,
        run.runId,
        run.projectId,
        `ep${String(run.episodeNum).padStart(3, '0')}`,
        run.currentStage,
        run.errorMessage,
        run.recoveryNote,
        run.batchLabel,
        run.batchId,
        run.priority,
        run.templateLabel,
        run.templateId,
        run.scheduleLabel,
        run.scheduleId,
        run.automationKey,
        run.dependsOnRootRunId,
        run.scheduledAt
      ].filter(Boolean).join(' ').toLowerCase()

      return haystack.includes(keyword)
    })
  }, [priorityFilter, projectFilter, runs, search, stageFilter, statusFilter])

  useEffect(() => {
    if (filteredRuns.length === 0) {
      setSelectedRunId(null)
      setSelectedRunDetail(null)
      return
    }

    if (selectedRunId && filteredRuns.some((run) => run.runId === selectedRunId)) return
    setSelectedRunId(filteredRuns[0].runId)
  }, [filteredRuns, selectedRunId])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunDetail(null)
      return
    }

    let cancelled = false
    const loadDetail = async () => {
      setDetailLoading(true)
      try {
        const detail = await platformAPI.invoke(IPC.PIPELINE_GET_RUN_DETAIL, selectedRunId) as PipelineRunDetail | null
        if (!cancelled) {
          setSelectedRunDetail(detail)
        }
      } catch {
        if (!cancelled) {
          setSelectedRunDetail(null)
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    void loadDetail()
    const timer = window.setInterval(() => {
      void loadDetail()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedRunId])

  const selectedRun = filteredRuns.find((run) => run.runId === selectedRunId) || selectedRunDetail?.run || null
  const selectedScopeRuns = useMemo(() => {
    if (!selectedRun) return []
    if (selectedRun.batchId) {
      return pickLatestPipelineRuns(runs.filter((run) => run.batchId === selectedRun.batchId))
    }
    return pickLatestPipelineRuns(runs.filter((run) => run.rootRunId === selectedRun.rootRunId))
  }, [runs, selectedRun])
  const selectedScopeSummary = useMemo(
    () => summarizePipelineRuns(selectedScopeRuns),
    [selectedScopeRuns]
  )
  const selectedRunLLMCalls: PipelineLLMCallRecord[] = selectedRunDetail?.llmCalls || []
  const summary = useMemo(() => ({
    total: runs.length,
    queued: runs.filter((run) => run.status === 'queued').length,
    running: runs.filter((run) => run.status === 'running' || run.status === 'paused').length,
    failed: runs.filter((run) => run.status === 'failed').length,
    deadLetter: runs.filter((run) => run.status === 'dead_letter').length,
    completed: runs.filter((run) => run.status === 'completed').length,
    archived: runs.filter((run) => !!run.archivedAt).length
  }), [runs])
  const exportProject = useMemo(
    () => projects.find((project) => project.id === projectFilter) || null,
    [projectFilter, projects]
  )
  const diagnosticsSummary = diagnostics?.queueSummary
  const diagnosticsIssues = diagnostics?.issues || []
  const attentionCard = useMemo(() => {
    if (diagnosticsIssues.length > 0) {
      return {
        title: '存在运行或配置异常',
        description: `当前有 ${diagnosticsIssues.length} 条运行时诊断问题，建议先检查诊断面板和失败任务。`,
        action: '查看运行健康'
      }
    }
    if (summary.failed > 0 || summary.deadLetter > 0) {
      return {
        title: '优先清理失败任务',
        description: `当前失败 ${summary.failed} 条，死信 ${summary.deadLetter} 条。建议先定位失败批次，再决定是否重试。`,
        action: '筛到失败任务'
      }
    }
    if (summary.running > 0) {
      return {
        title: '当前有任务正在推进',
        description: `当前有 ${summary.running} 条任务处于运行或暂停状态，建议先观察关键任务再批量操作。`,
        action: '筛到进行中'
      }
    }
    return {
      title: '当前队列相对稳定',
      description: '没有明显的失败和诊断阻塞，可以把重点放在调度检查、闭环报告和项目推进上。',
      action: '查看全部任务'
    }
  }, [diagnosticsIssues.length, summary.deadLetter, summary.failed, summary.running])

  const handleAttentionAction = useCallback(() => {
    if (diagnosticsIssues.length > 0) {
      const el = document.querySelector('.task-runtime-diagnostics')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (summary.failed > 0 || summary.deadLetter > 0) {
      setStatusFilter('failed')
      return
    }
    if (summary.running > 0) {
      setStatusFilter('running')
      return
    }
    setStatusFilter('all')
  }, [diagnosticsIssues.length, summary.deadLetter, summary.failed, summary.running])

  const focusedProject = useMemo(() => {
    if (projectFilter !== 'all') {
      return projects.find((project) => project.id === projectFilter) || null
    }
    if (selectedRun) {
      return projects.find((project) => project.id === selectedRun.projectId) || null
    }
    return null
  }, [projectFilter, projects, selectedRun])
  const focusedTaskSettings = useMemo(
    () => resolveProjectTaskSettings(focusedProject?.config),
    [focusedProject]
  )
  const focusedProjectPreset = useMemo(
    () => resolveBuiltinProjectPreset(focusedProject?.config.templateProfileId),
    [focusedProject]
  )
  const focusedExportProfile = useMemo(
    () => resolveBuiltinExportProfile(focusedProject?.config.exportProfileId),
    [focusedProject]
  )
  const focusedValidationIssues = useMemo(
    () => focusedProject
      ? validateProjectTaskAutomation(focusedProject.config, focusedProject.totalEpisodes)
      : [],
    [focusedProject]
  )
  const focusedEnabledSchedules = focusedProject?.config.taskSchedules?.filter((schedule) => schedule.enabled) || []

  const handleOpenProject = useCallback((run: PipelineRunRecord) => {
    void (async () => {
      const project = projects.find((item) => item.id === run.projectId) || null
      const loaded = await loadProject(run.projectId)
      if (!loaded && project) {
        setCurrentProject(project)
      }
      navigate(`/project/${run.projectId}/production?tab=pipeline&ep=${run.episodeNum}`)
    })()
  }, [loadProject, navigate, projects, setCurrentProject])

  const handleCancelRun = useCallback(async (runId: string) => {
    operationFeedback.start('cancel-run', '正在取消任务', '正在向队列或执行器发送取消请求。')
    const result = await platformAPI.invoke(IPC.PIPELINE_CANCEL_RUN, runId) as { success?: boolean }
    if (!result.success) {
      operationFeedback.fail('cancel-run', '取消任务失败', '队列任务取消失败。')
      return
    }
    operationFeedback.warn('cancel-run', '已请求取消任务', '当前任务已发送取消请求。', false)
    addToast('warning', '已请求取消任务')
    await refreshRuns()
  }, [addToast, operationFeedback, refreshRuns])

  const handleRetryRun = useCallback(async (runId: string) => {
    operationFeedback.start('retry-run', '正在重新入队任务', '正在根据历史参数重新创建任务。')
    const result = await platformAPI.invoke(IPC.PIPELINE_RETRY_RUN, runId) as {
      success?: boolean
      error?: string
      run?: PipelineRunRecord
    }
    if (!result.success || !result.run) {
      operationFeedback.fail('retry-run', '重新入队失败', result.error || '重试任务失败')
      return
    }
    operationFeedback.succeed('retry-run', '任务已重新入队', '任务已重新进入策略队列。', false)
    addToast('info', '任务已重新进入队列')
    setSelectedRunId(result.run.runId)
    await refreshRuns()
  }, [addToast, operationFeedback, refreshRuns])

  const handleArchiveRuns = useCallback(async () => {
    operationFeedback.start('archive-runs', '正在归档历史任务', '正在清理过期的已结束任务记录。')
    const result = await platformAPI.invoke(IPC.PIPELINE_ARCHIVE_RUNS, archiveDays) as {
      success?: boolean
      count?: number
    }
    if (!result.success) {
      operationFeedback.fail('archive-runs', '归档任务失败', '历史任务归档失败。')
      return
    }
    operationFeedback.succeed('archive-runs', '历史任务已归档', `已归档 ${result.count || 0} 条历史任务。`, false)
    addToast('info', `已归档 ${result.count || 0} 条历史任务`)
    await refreshRuns()
  }, [addToast, archiveDays, operationFeedback, refreshRuns])

  const handleExportAudit = useCallback(async () => {
    if (!exportProject) {
      operationFeedback.warn('export-audit', '无法生成审计报告', '请先筛选到单个项目，再生成审计报告')
      return
    }
    if (filteredRuns.length === 0) {
      operationFeedback.warn('export-audit', '无法生成审计报告', '当前筛选结果为空，没有可导出的任务记录')
      return
    }

    const filePath = buildAutomationReportOutputPath(
      exportProject.projectPath,
      buildAutomationAuditFileName()
    )
    try {
      operationFeedback.start('export-audit', '正在生成审计报告', '正在整理任务记录并写入项目审计报告。')
      const result = await platformAPI.invoke(
        IPC.FILE_WRITE,
        filePath,
        buildAutomationAuditReport({
          projectName: exportProject.name,
          generatedAt: new Date().toISOString(),
          includeArchived,
          runs: filteredRuns
        })
      ) as { success?: boolean }
      if (!result.success) {
        operationFeedback.fail('export-audit', '审计报告写入失败', '任务审计报告写入失败。')
        return
      }
      operationFeedback.succeed('export-audit', '审计报告已生成', `审计报告已写入 ${filePath}`, false)
      addToast('success', `审计报告已写入 ${filePath}`)
    } catch (error) {
      operationFeedback.fail('export-audit', '审计报告导出失败', error instanceof Error ? error.message : String(error))
    }
  }, [addToast, exportProject, filteredRuns, includeArchived, operationFeedback])

  const handleTriggerAutomationScan = useCallback(async () => {
    try {
      operationFeedback.start('scan-automation', '正在扫描自动化', '正在重新检查计划并更新运行时诊断。')
      const nextDiagnostics = await platformAPI.invoke(IPC.PIPELINE_TRIGGER_AUTOMATION_SCAN) as PipelineRuntimeDiagnostics
      setDiagnostics(nextDiagnostics)
      operationFeedback.succeed('scan-automation', '自动化扫描已完成', '已手动触发一次自动化扫描。', false)
      addToast('success', '已手动触发一次自动化扫描')
      await refreshRuns(true)
    } catch (error) {
      operationFeedback.fail('scan-automation', '自动化扫描失败', error instanceof Error ? error.message : String(error))
    }
  }, [addToast, operationFeedback, refreshRuns])

  const handleTriggerRecoverySweep = useCallback(async () => {
    try {
      operationFeedback.start('recovery-sweep', '正在执行恢复巡检', '正在回收孤儿任务、校正队列并更新死信状态。')
      const nextDiagnostics = await platformAPI.invoke(IPC.PIPELINE_TRIGGER_RECOVERY_SWEEP) as PipelineRuntimeDiagnostics
      setDiagnostics(nextDiagnostics)
      operationFeedback.succeed('recovery-sweep', '恢复巡检已完成', '运行稳定性巡检已执行完毕。', false)
      addToast('success', '运行稳定性巡检已完成')
      await refreshRuns(true)
    } catch (error) {
      operationFeedback.fail('recovery-sweep', '恢复巡检失败', error instanceof Error ? error.message : String(error))
    }
  }, [addToast, operationFeedback, refreshRuns])

  const handleExportDiagnostics = useCallback(async () => {
    if (!diagnostics) {
      operationFeedback.warn('export-diagnostics', '无法导出诊断快照', '当前没有可导出的诊断数据')
      return
    }

    const projectPath = (exportProject || projects[0])?.projectPath || ''
    const filePath = projectPath
      ? buildAutomationReportOutputPath(projectPath, buildDiagnosticsSnapshotFileName())
      : ''
    if (!filePath) {
      operationFeedback.warn('export-diagnostics', '无法导出诊断快照', '请至少保证当前存在一个项目，再导出诊断快照')
      return
    }

    try {
      operationFeedback.start('export-diagnostics', '正在导出诊断快照', '正在把当前运行时诊断写入项目目录。')
      const result = await platformAPI.invoke(
        IPC.FILE_WRITE,
        filePath,
        serializeDiagnosticsSnapshot(diagnostics)
      ) as { success?: boolean }
      if (!result.success) {
        operationFeedback.fail('export-diagnostics', '诊断快照导出失败', '诊断快照写入失败。')
        return
      }
      operationFeedback.succeed('export-diagnostics', '诊断快照已导出', `诊断快照已写入 ${filePath}`, false)
      addToast('success', `诊断快照已写入 ${filePath}`)
    } catch (error) {
      operationFeedback.fail('export-diagnostics', '诊断快照导出失败', error instanceof Error ? error.message : String(error))
    }
  }, [addToast, diagnostics, exportProject, operationFeedback, projects])

  const handleRefreshAll = useCallback(async () => {
    operationFeedback.start('refresh-data', '正在刷新任务中心', '正在拉取最新任务列表与运行时诊断。')
    const [runsOk, diagnosticsOk] = await Promise.all([
      refreshRuns(true),
      refreshDiagnostics(true)
    ])
    if (runsOk && diagnosticsOk) {
      operationFeedback.succeed('refresh-data', '任务中心已刷新', '任务列表和运行时诊断都已更新。', false)
      return
    }
    operationFeedback.warn('refresh-data', '任务中心已部分刷新', '部分数据刷新失败，请检查当前运行状态。')
  }, [operationFeedback, refreshDiagnostics, refreshRuns])

  const handleExportSelectedClosure = useCallback(async () => {
    if (!selectedRun || selectedScopeRuns.length === 0) {
      operationFeedback.warn('export-closure', '无法导出闭环摘要', '请先选择一个任务或批次。')
      return
    }

    const project = projects.find((item) => item.id === selectedRun.projectId)
    if (!project) {
      operationFeedback.warn('export-closure', '无法导出闭环摘要', '当前任务所属项目不存在。')
      return
    }

    const scopeLabel = selectedRun.batchLabel || `任务 ${selectedRun.runId.slice(0, 8)}`
    const reportPath = buildAutomationReportOutputPath(
      project.projectPath,
      buildPipelineClosureFileName(scopeLabel)
    )
    operationFeedback.start('export-closure', '正在导出闭环摘要', '正在整理当前选择范围的任务结果。')
    try {
      const result = await platformAPI.invoke(
        IPC.FILE_WRITE,
        reportPath,
        buildPipelineClosureReport({
          projectName: project.name,
          generatedAt: new Date().toISOString(),
          scopeLabel,
          scopeType: selectedRun.batchId ? 'batch' : 'run',
          runs: selectedScopeRuns
        })
      ) as { success?: boolean }
      if (!result.success) {
        operationFeedback.fail('export-closure', '闭环摘要导出失败', '闭环摘要写入失败。')
        return
      }
      operationFeedback.succeed('export-closure', '闭环摘要已导出', `闭环摘要已写入 ${reportPath}`, false)
      addToast('success', `闭环摘要已写入 ${reportPath}`)
    } catch (error) {
      operationFeedback.fail('export-closure', '闭环摘要导出失败', error instanceof Error ? error.message : String(error))
    }
  }, [addToast, operationFeedback, projects, selectedRun, selectedScopeRuns])

  return (
    <div className="task-center-page">
      {isWebPreview && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <strong>{hasRemoteRuntime ? '网页远程运行模式' : '网页预览模式'}</strong>
          <p className="text-secondary" style={{ margin: '8px 0 0' }}>
            {hasRemoteRuntime
              ? '当前任务中心已连接远程后端。任务列表、诊断、取消、重试、计划触发和报告导出都可在网页端直接使用。'
              : '当前任务中心展示的是浏览器安全占位数据。自动化扫描、恢复巡检和真实任务执行仍需要桌面端或服务端运行时。'}
          </p>
        </div>
      )}
      <div className="task-center-header">
        <div>
          <h1>任务中心</h1>
          <p className="text-secondary">从跨项目视角看当前制作任务是否稳定、哪里在阻塞、下一步该先处理哪类任务。</p>
        </div>
        <div className="task-center-header-actions">
          <button className="btn" onClick={() => void handleTriggerAutomationScan()} disabled={!supportsRuntimeOperations}>
            立即扫描自动化
          </button>
          <button className="btn" onClick={() => void handleTriggerRecoverySweep()} disabled={!supportsRuntimeOperations}>
            运行恢复巡检
          </button>
          <button className="btn" onClick={() => void handleExportDiagnostics()} disabled={!diagnostics}>
            导出诊断快照
          </button>
          <button className="btn" onClick={() => void handleExportAudit()} disabled={!exportProject || filteredRuns.length === 0}>
            生成审计报告
          </button>
          <button className="btn" onClick={() => void handleRefreshAll()}>
            {loading || operationFeedback.activeAction === 'refresh-data' ? '刷新中...' : '刷新列表'}
          </button>
        </div>
      </div>
      <OperationStatusBanner feedback={operationFeedback.feedback} onDismiss={operationFeedback.clear} />

      <div className="task-center-hero">
        <div className="card task-center-focus">
          <div className="task-center-focus-head">
            <h3>当前关注点</h3>
            <span className="text-secondary text-xs">{attentionCard.action}</span>
          </div>
          <div className="task-center-focus-body">
            <strong>{attentionCard.title}</strong>
            <p className="text-secondary">{attentionCard.description}</p>
            <div className="task-center-focus-actions">
              <button className="btn btn-primary" onClick={() => void handleAttentionAction()}>
                {attentionCard.action}
              </button>
              <button className="btn" onClick={() => setStatusFilter('all')}>
                重置筛选
              </button>
            </div>
          </div>
        </div>

        <div className="card task-center-focus">
          <div className="task-center-focus-head">
            <h3>当前视角</h3>
            <span className="text-secondary text-xs">{projectFilter === 'all' ? '跨项目' : '单项目'}</span>
          </div>
          <div className="task-center-glance">
            <div className="task-center-glance-item">
              <span className="task-summary-label">当前项目</span>
              <strong>{focusedProject?.name || '全部项目'}</strong>
            </div>
            <div className="task-center-glance-item">
              <span className="task-summary-label">筛选结果</span>
              <strong>{filteredRuns.length}/{runs.length}</strong>
            </div>
            <div className="task-center-glance-item">
              <span className="task-summary-label">自动化计划</span>
              <strong>{diagnostics?.automation.enabledScheduleCount || 0}</strong>
            </div>
            <div className="task-center-glance-item">
              <span className="task-summary-label">最近活跃任务</span>
              <strong>{diagnostics?.activeRun ? `EP${String(diagnostics.activeRun.episodeNum).padStart(3, '0')}` : '空闲'}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="task-center-summary">
        <div className="task-summary-card">
          <span className="task-summary-label">任务总量</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">排队中</span>
          <strong>{summary.queued}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">执行中</span>
          <strong>{summary.running}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">失败</span>
          <strong>{summary.failed}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">死信</span>
          <strong>{summary.deadLetter}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">已完成</span>
          <strong>{summary.completed}</strong>
        </div>
        <div className="task-summary-card">
          <span className="task-summary-label">已归档</span>
          <strong>{summary.archived}</strong>
        </div>
      </div>

      {focusedProject && (
        <div className="task-automation-overview card">
          <div className="task-run-list-header">
            <h3>项目自动化概览</h3>
            <span className="text-secondary text-xs">{focusedProject.name}</span>
          </div>
          <div className="task-runtime-grid">
            <div className="task-runtime-card">
              <span className="task-summary-label">项目预设</span>
              <strong>{focusedProjectPreset?.label || '未配置'}</strong>
            </div>
            <div className="task-runtime-card">
              <span className="task-summary-label">默认导出模板</span>
              <strong>{focusedExportProfile?.label || '未配置'}</strong>
            </div>
            <div className="task-runtime-card">
              <span className="task-summary-label">可用任务模板</span>
              <strong>{focusedTaskSettings.templates.length}</strong>
            </div>
            <div className="task-runtime-card">
              <span className="task-summary-label">启用调度</span>
              <strong>{focusedEnabledSchedules.length}</strong>
            </div>
            <div className="task-runtime-card">
              <span className="task-summary-label">自动化提醒</span>
              <strong>{focusedValidationIssues.length}</strong>
            </div>
          </div>
          <div className="task-runtime-meta text-secondary">
            {focusedProjectPreset?.description && <span>{focusedProjectPreset.description}</span>}
            {focusedExportProfile?.description && <span>{focusedExportProfile.description}</span>}
          </div>
          <div className="task-automation-chips">
            {focusedTaskSettings.templates.slice(0, 6).map((template) => (
              <span key={template.id} className="task-automation-chip">
                [{template.source === 'builtin' ? '内置' : '项目'}] {template.label}
              </span>
            ))}
            {focusedTaskSettings.templates.length > 6 && (
              <span className="task-automation-chip">+{focusedTaskSettings.templates.length - 6} 个模板</span>
            )}
          </div>
          {focusedEnabledSchedules.length > 0 && (
            <div className="task-automation-schedule-list">
              {focusedEnabledSchedules.map((schedule) => (
                <div key={schedule.id} className="task-automation-schedule-card">
                  <div>
                    <strong>{schedule.label}</strong>
                    <div className="task-run-item-meta">
                      <span>{schedule.frequency === 'daily' ? `每日 ${schedule.timeValue}` : formatRunTime(schedule.timeValue)}</span>
                      <span>{schedule.episodeNumbers.length} 集</span>
                      {schedule.templateId && <span>模板 {schedule.templateId}</span>}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={async () => {
                      operationFeedback.start('trigger-schedule', '正在触发计划', `正在立即触发计划「${schedule.label}」。`)
                      const result = await platformAPI.invoke(
                        IPC.PIPELINE_TRIGGER_SCHEDULE,
                        focusedProject.id,
                        schedule.id
                      ) as { success?: boolean; error?: string; runs?: PipelineRunRecord[] }
                      if (!result.success || !result.runs) {
                        operationFeedback.fail('trigger-schedule', '计划触发失败', result.error || '计划触发失败')
                        return
                      }
                      operationFeedback.succeed('trigger-schedule', '计划已触发', `计划「${schedule.label}」已触发，${result.runs.length} 集进入队列`, false)
                      addToast('success', `计划「${schedule.label}」已触发，${result.runs.length} 集进入队列`)
                      await refreshRuns(true)
                      await refreshDiagnostics(true)
                    }}
                  >
                    立即触发
                  </button>
                </div>
              ))}
            </div>
          )}
          {focusedValidationIssues.length > 0 && (
            <div className="task-runtime-issues">
              {focusedValidationIssues.slice(0, 4).map((issue, index) => (
                <div key={`${issue.scope}-${issue.field}-${issue.id || index}`} className={`task-runtime-issue is-${issue.severity}`}>
                  <strong>{issue.severity === 'error' ? '错误' : '提醒'}</strong>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="task-run-actions">
            <button
              className="btn"
              onClick={() => {
                void loadProject(focusedProject.id)
                navigate(`/project/${focusedProject.id}`)
              }}
            >
              打开项目配置
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                void loadProject(focusedProject.id)
                navigate(`/project/${focusedProject.id}/production?tab=batch`)
              }}
            >
              进入批量执行
            </button>
          </div>
        </div>
      )}

      <div className="task-runtime-diagnostics card">
        <div className="task-run-list-header">
          <h3>运行健康</h3>
          <span className="text-secondary text-xs">
            {diagnostics?.generatedAt ? `更新时间 ${formatRunTime(diagnostics.generatedAt)}` : '暂无数据'}
          </span>
        </div>
        <div className="task-runtime-grid">
          <div className="task-runtime-card">
              <span className="task-summary-label">当前活跃任务</span>
              <strong>
              {diagnostics?.activeRun
                ? `EP${String(diagnostics.activeRun.episodeNum).padStart(3, '0')} · ${formatRunStage(diagnostics.activeRun.currentStage)}`
                : '空闲'}
            </strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">队列等待</span>
            <strong>{diagnosticsSummary?.total || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">等待定时释放</span>
            <strong>{diagnosticsSummary?.waitingForSchedule || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">等待依赖释放</span>
            <strong>{diagnosticsSummary?.waitingForDependency || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">死信任务</span>
            <strong>{diagnosticsSummary?.deadLetter || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">启用中的自动化计划</span>
            <strong>{diagnostics?.automation.enabledScheduleCount || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">配置问题</span>
            <strong>{diagnosticsIssues.length}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">LLM 调用</span>
            <strong>{diagnostics?.telemetry.callCount || 0}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">累计 Token</span>
            <strong>{formatTelemetryTokens(diagnostics?.telemetry.totalTokens || 0)}</strong>
          </div>
          <div className="task-runtime-card">
            <span className="task-summary-label">预估成本</span>
            <strong>{formatTelemetryUsd(diagnostics?.telemetry.estimatedCostUsd || 0)}</strong>
          </div>
        </div>
        <div className="task-runtime-meta text-secondary">
          <span>最近扫描：{formatRunTime(diagnostics?.automation.lastScanAt)}</span>
          <span>下次队列唤醒：{formatRunTime(diagnostics?.automation.nextQueueWakeAt)}</span>
          <span>最近恢复巡检：{formatRunTime(diagnostics?.recovery.lastSweepAt)}</span>
          <span>本轮回收：{diagnostics?.recovery.orphanedRunCount || 0}</span>
          <span>LLM 总耗时：{formatTelemetryDurationMs(diagnostics?.telemetry.totalDurationMs || 0)}</span>
          <span>最近调用：{formatRunTime(diagnostics?.telemetry.lastCalledAt)}</span>
          {diagnostics?.automation.lastScanError && <span>扫描错误：{diagnostics.automation.lastScanError}</span>}
          {diagnostics?.recovery.lastSweepError && <span>恢复错误：{diagnostics.recovery.lastSweepError}</span>}
        </div>
        {diagnosticsIssues.length > 0 && (
          <div className="task-runtime-issues">
            {diagnosticsIssues.slice(0, 8).map((issue, index) => (
              <div key={`${issue.projectId}-${issue.scope}-${issue.id || index}`} className={`task-runtime-issue is-${issue.severity}`}>
                <strong>{issue.projectName}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="task-center-filters card">
        <div className="task-center-filter-head">
          <h3>任务筛选</h3>
          <span className="text-secondary text-xs">统一收敛跨项目任务，快速定位失败、运行中或某个项目的任务范围。</span>
        </div>
        <input
          className="input task-center-search"
          placeholder="搜索项目名 / Run ID / EP / 模板 / 调度"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select className="input" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as StageFilter)}>
          {STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select className="input" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select className="input" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="all">全部项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <label className="task-checkbox">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          <span>包含已归档任务</span>
        </label>
        <div className="task-archive-tools">
          <select className="input" value={archiveDays} onChange={(event) => setArchiveDays(Number(event.target.value))}>
            <option value={3}>归档 3 天前已结束任务</option>
            <option value={7}>归档 7 天前已结束任务</option>
            <option value={14}>归档 14 天前已结束任务</option>
            <option value={30}>归档 30 天前已结束任务</option>
          </select>
          <button className="btn" onClick={() => void handleArchiveRuns()}>
            归档清理
          </button>
        </div>
      </div>

      <div className="task-center-layout">
        <div className="task-run-list card">
          <div className="task-run-list-header">
            <h3>任务队列</h3>
            <span className="text-secondary text-xs">{filteredRuns.length} / {runs.length}</span>
          </div>
          <div className="task-run-items">
            {filteredRuns.length === 0 ? (
              <EmptyState
                icon="🗂️"
                title="当前筛选范围内没有任务"
                description="可以放宽筛选条件，或者先去项目里触发一轮批量任务。"
              />
            ) : (
              filteredRuns.map((run) => (
                <button
                  key={run.runId}
                  className={`task-run-item is-status-${run.status} ${selectedRunId === run.runId ? 'is-selected' : ''}`}
                  onClick={() => setSelectedRunId(run.runId)}
                >
                  <div className="task-run-item-top">
                    <strong>{run.projectName || run.projectId}</strong>
                    <span className={`task-run-status status-${run.status}`}>{formatRunStatus(run.status)}</span>
                  </div>
                  <div className="task-run-item-meta">
                    <span className="task-meta-chip is-episode">EP{String(run.episodeNum).padStart(3, '0')}</span>
                    <span className={`task-meta-chip is-stage is-stage-${run.currentStage}`}>{formatRunStage(run.currentStage)}</span>
                    <span className="task-meta-chip is-mode">{run.singleStage ? '单阶段' : '全流程'}</span>
                    <span className={`task-meta-chip is-priority is-priority-${run.priority}`}>{formatRunPriority(run.priority)}</span>
                    <span className="task-meta-chip is-attempt">尝试 {run.attempt + 1}/{run.maxAutoRetries + 1}</span>
                    {run.batchLabel && <span className="task-meta-chip">{run.batchLabel}</span>}
                    {run.templateLabel && <span className="task-meta-chip">模板 {run.templateLabel}</span>}
                    {run.scheduleLabel && <span className="task-meta-chip">调度 {run.scheduleLabel}</span>}
                    {run.dependsOnRootRunId && <span className="task-meta-chip is-dependency">依赖 {run.dependsOnRootRunId.slice(0, 8)}</span>}
                    {run.scheduledAt && <span className="task-meta-chip is-time">定时 {formatRunTime(run.scheduledAt)}</span>}
                    <span className="task-meta-chip is-time">{run.status === 'queued' ? `排队 ${formatRunTime(run.queuedAt)}` : formatRunTime(run.startedAt)}</span>
                    {run.telemetry?.callCount ? <span className="task-meta-chip">LLM {run.telemetry.callCount}</span> : null}
                    {run.telemetry?.estimatedCostUsd ? <span className="task-meta-chip">成本 {formatTelemetryUsd(run.telemetry.estimatedCostUsd)}</span> : null}
                    {typeof run.queuePosition === 'number' && <span className="task-meta-chip is-queue">队列 #{run.queuePosition}</span>}
                    {run.archivedAt && <span className="task-meta-chip is-archived">已归档</span>}
                  </div>
                  <div className="task-run-item-id">{run.runId}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className={`task-run-detail card ${selectedRun ? `is-status-${selectedRun.status}` : ''}`}>
          {!selectedRun ? (
            <EmptyState
              icon="🧭"
              title="选择一个任务查看详情"
              description="右侧会显示当前任务的闭环范围、运行日志、LLM 调用和重试入口。"
            />
          ) : (
            <>
              <div className="task-run-detail-header">
                <div className="task-run-detail-summary">
                  <div className="task-run-detail-title-row">
                    <h3>{selectedRun.projectName || selectedRun.projectId}</h3>
                    {detailLoading && <span className="task-run-detail-loading">加载中...</span>}
                  </div>
                  <div className="task-run-detail-id">Run ID · {selectedRun.runId}</div>
                  <div className="task-run-detail-meta">
                    <span className="task-meta-chip is-episode">EP{String(selectedRun.episodeNum).padStart(3, '0')}</span>
                    <span className={`task-run-status status-${selectedRun.status}`}>{formatRunStatus(selectedRun.status)}</span>
                    <span className={`task-meta-chip is-stage is-stage-${selectedRun.currentStage}`}>{formatRunStage(selectedRun.currentStage)}</span>
                    <span className="task-meta-chip is-mode">{selectedRun.singleStage ? '单阶段' : '全流程'}</span>
                    <span className={`task-meta-chip is-priority is-priority-${selectedRun.priority}`}>{formatRunPriority(selectedRun.priority)}</span>
                    <span className="task-meta-chip is-attempt">尝试 {selectedRun.attempt + 1}/{selectedRun.maxAutoRetries + 1}</span>
                    {selectedRun.batchLabel && <span className="task-meta-chip">{selectedRun.batchLabel}</span>}
                    {selectedRun.templateLabel && <span className="task-meta-chip">模板 {selectedRun.templateLabel}</span>}
                    {selectedRun.scheduleLabel && <span className="task-meta-chip">调度 {selectedRun.scheduleLabel}</span>}
                    {selectedRun.dependsOnRootRunId && <span className="task-meta-chip is-dependency">依赖 {selectedRun.dependsOnRootRunId}</span>}
                    {selectedRun.scheduledAt && <span className="task-meta-chip is-time">定时 {formatRunTime(selectedRun.scheduledAt)}</span>}
                    {selectedRun.automationKey && <span className="task-meta-chip">自动化 {selectedRun.automationKey}</span>}
                    <span className="task-meta-chip is-time">排队 {formatRunTime(selectedRun.queuedAt)}</span>
                    {selectedRun.startedAt && <span className="task-meta-chip is-time">启动 {formatRunTime(selectedRun.startedAt)}</span>}
                    {selectedRun.endedAt && <span className="task-meta-chip is-time">结束 {formatRunTime(selectedRun.endedAt)}</span>}
                    {selectedRun.startedAt && selectedRun.endedAt && <span className="task-meta-chip is-time">耗时 {formatRunDuration(selectedRun)}</span>}
                    <span className="task-meta-chip">LLM {selectedRun.telemetry?.callCount || 0}</span>
                    <span className="task-meta-chip">Token {formatTelemetryTokens(selectedRun.telemetry?.totalTokens || 0)}</span>
                    <span className="task-meta-chip">成本 {formatTelemetryUsd(selectedRun.telemetry?.estimatedCostUsd || 0)}</span>
                    {selectedRun.archivedAt && <span className="task-meta-chip is-archived">归档 {formatRunTime(selectedRun.archivedAt)}</span>}
                  </div>
                </div>
              </div>

              <div className="task-run-actions">
                <button className="btn" onClick={() => void handleOpenProject(selectedRun)}>
                  打开项目
                </button>
                <button className="btn" onClick={() => void handleExportSelectedClosure()}>
                  导出闭环摘要
                </button>
                {isCancelable(selectedRun.status) && (
                  <button className="btn btn-danger" onClick={() => void handleCancelRun(selectedRun.runId)}>
                    取消任务
                  </button>
                )}
                {isRetryable(selectedRun.status) && (
                  <button className="btn btn-primary" onClick={() => void handleRetryRun(selectedRun.runId)}>
                    重新入队
                  </button>
                )}
              </div>

              {(selectedRun.recoveryNote || selectedRun.errorMessage) && (
                <div className="task-run-error">
                  {selectedRun.recoveryNote || selectedRun.errorMessage}
                </div>
              )}

              <div className="task-runtime-grid">
                <div className="task-runtime-card">
                  <span className="task-summary-label">闭环任务数</span>
                  <strong>{selectedScopeSummary.total}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">已完成</span>
                  <strong>{selectedScopeSummary.completed}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">失败</span>
                  <strong>{selectedScopeSummary.failed}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">死信</span>
                  <strong>{selectedScopeSummary.deadLetter}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">范围</span>
                  <strong>{selectedRun.batchLabel || `任务 ${selectedRun.runId.slice(0, 8)}`}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">LLM 调用</span>
                  <strong>{selectedRun.telemetry?.callCount || 0}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">累计 Token</span>
                  <strong>{formatTelemetryTokens(selectedRun.telemetry?.totalTokens || 0)}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">预估成本</span>
                  <strong>{formatTelemetryUsd(selectedRun.telemetry?.estimatedCostUsd || 0)}</strong>
                </div>
                <div className="task-runtime-card">
                  <span className="task-summary-label">失败分类</span>
                  <strong>{formatFailureClass(selectedRun.telemetry?.lastFailureClass)}</strong>
                </div>
              </div>

              <div className="task-run-telemetry-summary">
                <span>LLM 总耗时：{formatTelemetryDurationMs(selectedRun.telemetry?.totalDurationMs || 0)}</span>
                <span>成功/失败：{selectedRun.telemetry?.successCount || 0} / {selectedRun.telemetry?.failureCount || 0}</span>
                <span>最近模型：{selectedRun.telemetry?.lastProvider || '--'} / {selectedRun.telemetry?.lastModel || '--'}</span>
                <span>最近调用：{formatRunTime(selectedRun.telemetry?.lastCalledAt)}</span>
              </div>

              <div className="task-run-log-section">
                <div className="task-run-log-header">
                  <h4>LLM 调用明细</h4>
                  <span className="text-secondary text-xs">{selectedRunLLMCalls.length} 次</span>
                </div>
                <div className="task-run-llm-calls">
                  {selectedRunLLMCalls.length === 0 ? (
                    <div className="log-empty text-secondary">当前任务暂无可展示的 LLM 调用遥测。</div>
                  ) : (
                    selectedRunLLMCalls.map((call) => (
                      <div key={call.id} className={`task-run-llm-call is-${call.status}`}>
                        <div className="task-run-llm-call-top">
                          <strong>{formatRunStage(call.stage)} · {call.phase === 'stage_execution' ? '执行' : call.phase === 'business_review' ? '业务审核' : '合规审核'}</strong>
                          <span>{call.status === 'success' ? '成功' : `失败 · ${formatFailureClass(call.failureClass)}`}</span>
                        </div>
                        <div className="task-run-item-meta">
                          <span>{call.provider} / {call.model}</span>
                          <span>{call.stream ? '流式' : '非流式'}</span>
                          <span>耗时 {formatTelemetryDurationMs(call.durationMs)}</span>
                          <span>Token {formatTelemetryTokens(call.usage?.totalTokens || 0)}</span>
                          <span>成本 {formatTelemetryUsd(call.estimatedCostUsd || 0)}</span>
                          <span>{formatRunTime(call.startedAt)}</span>
                        </div>
                        {call.errorMessage && <div className="task-run-llm-call-error">{call.errorMessage}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="task-run-log-section">
                <div className="task-run-log-header">
                  <h4>运行日志</h4>
                  <span className="text-secondary text-xs">{(selectedRunDetail?.logs || []).length} 条</span>
                </div>
                <div className="task-run-logs">
                  {(selectedRunDetail?.logs || []).length === 0 ? (
                    <div className="log-empty text-secondary">
                      {selectedRun.status === 'queued' ? '任务还在等待执行。' : '当前任务暂无持久化日志。'}
                    </div>
                  ) : (
                    (selectedRunDetail?.logs || []).map((log: LogEntry) => (
                      <div key={log.id} className={`log-entry log-${log.level}`}>
                        <span className="log-icon">{getLogIcon(log.level, log.eventType)}</span>
                        <span className="log-time">
                          {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        <span className="log-message">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
