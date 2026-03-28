import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useOperationFeedback } from '@renderer/hooks/useOperationFeedback'
import { useToastStore } from '@renderer/stores/toastStore'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { IPC } from '@shared/ipc-channels'
import { resolveScheduleOccurrence } from '@shared/pipeline-automation'
import { resolveProjectTaskSettings } from '@shared/project-task-settings'
import type {
  PipelineBatchMode,
  PipelineRunPriority,
  PipelineRunRecord,
  PipelineRunStatus,
  ProjectTaskSchedule,
  ProjectTaskTemplate
} from '@shared/types'
import { BATCH_MODE_MAP as MODE_MAP, type BatchMode, buildBatchPlan } from './batch-planner'
import {
  buildAutomationReportOutputPath,
  buildPipelineClosureFileName,
  buildPipelineClosureReport,
  pickLatestPipelineRuns,
  summarizePipelineRuns,
  type PipelineRunSummaryStats
} from './task-center-reporting'
import OperationStatusBanner from '@renderer/components/layout/OperationStatusBanner'
import './BatchPage.css'

const PRIORITY_OPTIONS: Array<{ value: PipelineRunPriority; label: string }> = [
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '标准优先级' },
  { value: 'low', label: '低优先级' }
]

interface BatchTask {
  runId: string
  rootRunId: string
  episodeNum: number
  status: PipelineRunStatus
  progress: string
  queuePosition?: number
  errorMessage?: string
  attempt: number
  maxAutoRetries: number
  priority: PipelineRunPriority
  batchLabel?: string
}

interface BatchClosureSnapshot {
  batchLabel: string
  reportPath: string
  generatedAt: string
  summary: PipelineRunSummaryStats
}

function isRunActive(status: PipelineRunStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'paused'
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

function formatTaskProgress(run: PipelineRunRecord): string {
  if (run.status === 'queued') {
    return `队列中${run.queuePosition ? ` #${run.queuePosition}` : ''}`
  }
  if (run.status === 'running') {
    return `执行中 · ${run.currentStage}`
  }
  if (run.status === 'paused') {
    return `已暂停 · ${run.currentStage}`
  }
  if (run.status === 'completed') {
    return run.endedAt ? `已完成 · ${new Date(run.endedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '已完成'
  }
  if (run.status === 'failed') {
    return run.errorMessage || '执行失败'
  }
  if (run.status === 'dead_letter') {
    return run.recoveryNote || run.errorMessage || '已转入死信'
  }
  return '已取消'
}

function mapRunToTask(run: PipelineRunRecord): BatchTask {
  return {
    runId: run.runId,
    rootRunId: run.rootRunId,
    episodeNum: run.episodeNum,
    status: run.status,
    progress: formatTaskProgress(run),
    queuePosition: run.queuePosition,
    errorMessage: run.errorMessage,
    attempt: run.attempt,
    maxAutoRetries: run.maxAutoRetries,
    priority: run.priority,
    batchLabel: run.batchLabel
  }
}

function getTemplateSourceLabel(template: ProjectTaskTemplate): string {
  return template.source === 'builtin' ? '内置' : '项目'
}

function getTemplateExecutionLabel(template: ProjectTaskTemplate): string {
  if (!template.startStage) return '全流程'
  return MODE_MAP[template.startStage].label
}

interface BatchPageProps {
  embedded?: boolean
}

export default function BatchPage({ embedded = false }: BatchPageProps) {
  useProjectSync()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const {
    logs,
    streamBuffer,
    setupEventListeners,
    clearLogs,
    isRunning: pipelineRunning,
    state: pipelineState,
    context: pipelineContext,
    resumePipeline,
    stopPipeline,
    syncFromBackend
  } = usePipelineStore()
  const { addToast } = useToastStore()
  const operationFeedback = useOperationFeedback(addToast)
  const isWebPreview = platformAPI.isWebPreview
  const hasRemoteRuntime = platformAPI.capabilities.pipelineRuntime

  const [mode, setMode] = useState<BatchMode>('full')
  const [priority, setPriority] = useState<PipelineRunPriority>('normal')
  const [maxAutoRetries, setMaxAutoRetries] = useState(1)
  const [batchMode, setBatchMode] = useState<PipelineBatchMode>('independent')
  const [scheduledAt, setScheduledAt] = useState('')
  const [templates, setTemplates] = useState<ProjectTaskTemplate[]>([])
  const [schedules, setSchedules] = useState<ProjectTaskSchedule[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [batchLabel, setBatchLabel] = useState(() => `批次 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
  const [selectedEps, setSelectedEps] = useState<Set<number>>(new Set())
  const [tasks, setTasks] = useState<BatchTask[]>([])
  const [trackedBatchId, setTrackedBatchId] = useState<string | null>(null)
  const [trackedRootRunIds, setTrackedRootRunIds] = useState<string[]>([])
  const [lastClosureSnapshot, setLastClosureSnapshot] = useState<BatchClosureSnapshot | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [logExpanded, setLogExpanded] = useState(true)
  const logBodyRef = useRef<HTMLDivElement>(null)
  const shouldFollowLogRef = useRef(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const summaryKeyRef = useRef<string | null>(null)
  const closureKeyRef = useRef<string | null>(null)

  const enginePaused = pipelineState === 'paused'
  const activeBatch = !!trackedBatchId && tasks.some((task) => trackedRootRunIds.includes(task.rootRunId) && isRunActive(task.status))
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) || null
  const batchPreview = useMemo(() => {
    const label = batchLabel.trim() || `批次 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    try {
      return buildBatchPlan({
        selectedEpisodes: [...selectedEps],
        mode,
        batchMode,
        batchLabel: label,
        priority,
        maxAutoRetries,
        scheduledAt,
        selectedTemplate,
        batchId: 'preview-batch'
      })
    } catch {
      return null
    }
  }, [batchLabel, batchMode, maxAutoRetries, mode, priority, scheduledAt, selectedEps, selectedTemplate])

  const applyTemplate = useCallback((template: ProjectTaskTemplate | null) => {
    if (!template) return
    setPriority(template.priority)
    setMaxAutoRetries(template.maxAutoRetries)
    setBatchMode(template.batchMode)
    setMode(template.startStage || 'full')
    setBatchLabel(`${template.label} · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
  }, [])

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      syncEpisodeStatus()
    }
  }, [currentProject?.id, episodes.length, syncEpisodeStatus])

  useEffect(() => {
    setSelectedEps((prev) => {
      if (prev.size === 0) return prev
      const validEpisodes = new Set(episodes.map((ep) => ep.episodeNumber))
      const next = new Set([...prev].filter((ep) => validEpisodes.has(ep)))
      return next.size === prev.size ? prev : next
    })
  }, [episodes, currentProject?.id])

  useEffect(() => {
    summaryKeyRef.current = null
    const taskSettings = resolveProjectTaskSettings(currentProject?.config)
    setSelectedEps(new Set())
    setTasks([])
    setTrackedBatchId(null)
    setTrackedRootRunIds([])
    setLastClosureSnapshot(null)
    setIsSubmitting(false)
    setLogExpanded(true)
    closureKeyRef.current = null
    setPriority(taskSettings.defaults.defaultPriority)
    setMaxAutoRetries(taskSettings.defaults.defaultMaxAutoRetries)
    setBatchMode(taskSettings.defaults.defaultBatchMode)
    setScheduledAt('')
    setTemplates(taskSettings.templates)
    setSchedules(taskSettings.schedules.filter((schedule) => schedule.enabled))
    setSelectedTemplateId('')
    setBatchLabel(`批次 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
  }, [currentProject?.id])

  useEffect(() => {
    if (!selectedTemplateId) return
    if (templates.some((item) => item.id === selectedTemplateId)) return
    setSelectedTemplateId('')
  }, [selectedTemplateId, templates])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    void syncFromBackend()
  }, [currentProject?.id, syncFromBackend])

  useEffect(() => {
    if (logExpanded && shouldFollowLogRef.current) {
      logBodyRef.current?.scrollTo({
        top: logBodyRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [logs.length, streamBuffer, logExpanded])

  const handleLogScroll = useCallback(() => {
    const element = logBodyRef.current
    if (!element) return
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    shouldFollowLogRef.current = distanceToBottom <= 48
  }, [])

  const refreshTrackedRuns = useCallback(async () => {
    if (!currentProject || !trackedBatchId) return

    try {
      const runs = await platformAPI.invoke(
        IPC.PIPELINE_LIST_RUNS,
        currentProject.id,
        Math.max(120, trackedRootRunIds.length * 12),
        true
      ) as PipelineRunRecord[]

      const batchRuns = runs.filter((run) => run.batchId === trackedBatchId)
      const latestRuns = pickLatestPipelineRuns(batchRuns)
      setTasks(latestRuns.map(mapRunToTask))
    } catch {
      // 忽略轮询失败，保留上一帧
    }
  }, [currentProject, trackedBatchId, trackedRootRunIds.length])

  useEffect(() => {
    if (!trackedBatchId) return
    void refreshTrackedRuns()

    const timer = window.setInterval(() => {
      void refreshTrackedRuns()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [refreshTrackedRuns, trackedBatchId])

  const exportClosureReport = useCallback(async (runs: PipelineRunRecord[], scopeLabel: string) => {
    if (!currentProject || runs.length === 0) return null
    const generatedAt = new Date().toISOString()
    const reportPath = buildAutomationReportOutputPath(
      currentProject.projectPath,
      buildPipelineClosureFileName(scopeLabel)
    )
    const content = buildPipelineClosureReport({
      projectName: currentProject.name,
      generatedAt,
      scopeLabel,
      scopeType: 'batch',
      runs
    })
    const result = await platformAPI.invoke(IPC.FILE_WRITE, reportPath, content) as { success?: boolean }
    if (!result.success) {
      throw new Error('任务闭环摘要写入失败')
    }
    const snapshot: BatchClosureSnapshot = {
      batchLabel: scopeLabel,
      reportPath,
      generatedAt,
      summary: summarizePipelineRuns(runs)
    }
    setLastClosureSnapshot(snapshot)
    return snapshot
  }, [currentProject])

  useEffect(() => {
    if (trackedRootRunIds.length === 0) return

    const trackedTasks = tasks.filter((task) => trackedRootRunIds.includes(task.rootRunId))
    if (trackedTasks.length !== trackedRootRunIds.length) return
    if (trackedTasks.some((task) => isRunActive(task.status))) return

    const summaryKey = trackedTasks.map((task) => `${task.rootRunId}:${task.status}:${task.attempt}`).join('|')
    if (summaryKeyRef.current === summaryKey) return
    summaryKeyRef.current = summaryKey
    setIsSubmitting(false)

    const successCount = trackedTasks.filter((task) => task.status === 'completed').length
    const failedCount = trackedTasks.filter((task) => task.status === 'failed' || task.status === 'dead_letter').length
    const cancelledCount = trackedTasks.filter((task) => task.status === 'aborted').length

    if (failedCount > 0 || cancelledCount > 0) {
      operationFeedback.warn(
        'batch-summary',
        trackedTasks[0]?.batchLabel || '任务批次已完成',
        `批次结束：${successCount} 集成功，${failedCount} 集失败，${cancelledCount} 集取消`,
        false
      )
      addToast(
        'warning',
        `批次结束：${successCount} 集成功，${failedCount} 集失败，${cancelledCount} 集取消`,
        { title: trackedTasks[0]?.batchLabel || '任务批次已完成' }
      )
    } else {
      operationFeedback.succeed(
        'batch-summary',
        trackedTasks[0]?.batchLabel || '任务批次已完成',
        `批次完成：${successCount} 集全部成功`,
        false
      )
      addToast('success', `批次完成：${successCount} 集全部成功`, { title: trackedTasks[0]?.batchLabel || '任务批次已完成' })
    }

    void syncEpisodeStatus()
    const scopeLabel = trackedTasks[0]?.batchLabel || '任务批次'
    const closureKey = `${scopeLabel}:${summaryKey}`
    if (closureKeyRef.current === closureKey) return
    closureKeyRef.current = closureKey
    void (async () => {
      try {
        if (!currentProject || !trackedBatchId) return
        const runs = await platformAPI.invoke(
          IPC.PIPELINE_LIST_RUNS,
          currentProject.id,
          Math.max(120, trackedRootRunIds.length * 12),
          true
        ) as PipelineRunRecord[]
        const latestRuns = pickLatestPipelineRuns(runs.filter((run) => run.batchId === trackedBatchId))
        const snapshot = await exportClosureReport(latestRuns, scopeLabel)
        if (!snapshot) return
        operationFeedback.succeed('batch-closure', '任务闭环摘要已生成', `批次摘要已写入 ${snapshot.reportPath}`, false)
      } catch (error) {
        operationFeedback.warn('batch-closure', '批次已完成', error instanceof Error ? error.message : '任务闭环摘要生成失败')
      }
    })()
  }, [addToast, currentProject, exportClosureReport, operationFeedback, syncEpisodeStatus, tasks, trackedBatchId, trackedRootRunIds])

  const toggleEpisode = (num: number) => {
    setSelectedEps((prev) => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  const selectAll = () => {
    if (selectedEps.size === episodes.length) {
      setSelectedEps(new Set())
    } else {
      setSelectedEps(new Set(episodes.map((episode) => episode.episodeNumber)))
    }
  }

  const selectRange = (start: number, end: number) => {
    const nums = new Set(selectedEps)
    const validEpisodes = new Set(episodes.map((ep) => ep.episodeNumber))
    for (let i = start; i <= end; i++) {
      if (validEpisodes.has(i)) nums.add(i)
    }
    setSelectedEps(nums)
  }

  const getLogIcon = (level: string, eventType: string): string => {
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

  const trackQueuedRuns = useCallback((runs: PipelineRunRecord[]) => {
    if (runs.length === 0) return
    setTrackedBatchId(runs[0]?.batchId || null)
    setTrackedRootRunIds(runs.map((run) => run.rootRunId))
    setTasks(runs.map(mapRunToTask))
  }, [])

  const submitBatchPlan = useCallback(async (overrides?: {
    selectedEpisodes?: number[]
    selectedTemplate?: ProjectTaskTemplate | null
    batchLabel?: string
    scheduledAt?: string
    mode?: BatchMode
    batchMode?: PipelineBatchMode
    priority?: PipelineRunPriority
    maxAutoRetries?: number
  }) => {
    if (!currentProject) return

    const targetEpisodes = overrides?.selectedEpisodes || [...selectedEps]
    if (targetEpisodes.length === 0) {
      operationFeedback.warn('submit-batch', '无法提交批次', '请先选择至少一集')
      return
    }

    setIsSubmitting(true)
    setLogExpanded(true)
    clearLogs()
    summaryKeyRef.current = null
    closureKeyRef.current = null
    operationFeedback.start('submit-batch', '正在提交批次', '正在生成批次计划并把任务送入策略队列。')

    const nextBatchId = crypto.randomUUID()
    const label = (overrides?.batchLabel || batchLabel).trim() || `批次 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    const nextTasks: BatchTask[] = []
    const nextRootRunIds: string[] = []

    try {
      const plan = buildBatchPlan({
        selectedEpisodes: targetEpisodes,
        mode: overrides?.mode || mode,
        batchMode: overrides?.batchMode || batchMode,
        batchLabel: label,
        priority: overrides?.priority || priority,
        maxAutoRetries: overrides?.maxAutoRetries ?? maxAutoRetries,
        scheduledAt: overrides?.scheduledAt ?? scheduledAt,
        selectedTemplate: overrides?.selectedTemplate ?? selectedTemplate,
        batchId: nextBatchId
      })

      let previousRootRunId: string | undefined
      for (const request of plan.requests) {
        const result = await platformAPI.invoke(IPC.PIPELINE_ENQUEUE, {
          projectId: currentProject.id,
          projectPath: currentProject.projectPath,
          episodeNum: request.episodeNum,
          projectName: currentProject.name,
          visualStyle: currentProject.visualStyle,
          targetMedium: currentProject.targetMedium,
          startStage: request.startStage,
          singleStage: request.singleStage,
          strategy: request.strategy,
          orchestration: {
            ...request.orchestration,
            dependsOnRootRunId: request.orchestration.dependsOnRootRunId ? previousRootRunId : undefined
          }
        }) as { success?: boolean; error?: string; run?: PipelineRunRecord }

        if (!result.success || !result.run) {
          nextTasks.push({
            runId: `failed-${request.episodeNum}`,
            rootRunId: `failed-${request.episodeNum}`,
            episodeNum: request.episodeNum,
            status: 'failed',
            progress: result.error || '入队失败',
            errorMessage: result.error || '入队失败',
            attempt: 0,
            maxAutoRetries: request.strategy.maxAutoRetries,
            priority: request.strategy.priority,
            batchLabel: label
          })
          continue
        }

        nextRootRunIds.push(result.run.rootRunId)
        previousRootRunId = result.run.rootRunId
        nextTasks.push(mapRunToTask(result.run))
      }

      setTrackedBatchId(nextBatchId)
      setTrackedRootRunIds(nextRootRunIds)
      setTasks(nextTasks)

      const failedToQueue = nextTasks.filter((task) => task.status === 'failed' && task.runId.startsWith('failed-')).length
      if (nextRootRunIds.length > 0) {
        if (failedToQueue > 0) {
          operationFeedback.warn('submit-batch', '批次已部分提交', `已提交 ${nextRootRunIds.length} 集到策略队列，另有 ${failedToQueue} 集入队失败`)
        } else {
          operationFeedback.succeed('submit-batch', '批次已提交', `已提交 ${nextRootRunIds.length} 集到策略队列`, false)
        }
        addToast(
          failedToQueue > 0 ? 'warning' : 'info',
          failedToQueue > 0
            ? `已提交 ${nextRootRunIds.length} 集到策略队列，另有 ${failedToQueue} 集入队失败`
            : `已提交 ${nextRootRunIds.length} 集到策略队列`
        )
      } else {
        operationFeedback.fail('submit-batch', '批次提交失败', '没有任务成功进入队列')
      }
    } catch (error) {
      operationFeedback.fail('submit-batch', '批次规划失败', error instanceof Error ? error.message : '批次规划失败')
    } finally {
      setIsSubmitting(false)
    }
  }, [addToast, batchLabel, batchMode, clearLogs, currentProject, maxAutoRetries, mode, priority, scheduledAt, selectedEps, selectedTemplate])

  const handleBatchRun = useCallback(async () => {
    await submitBatchPlan()
  }, [submitBatchPlan])

  const applyScheduleToForm = useCallback((schedule: ProjectTaskSchedule) => {
    const template = templates.find((item) => item.id === schedule.templateId) || null
    setSelectedEps(new Set(schedule.episodeNumbers))
    setSelectedTemplateId(schedule.templateId || '')
    if (template) {
      applyTemplate(template)
    }
    setBatchLabel(`计划 · ${schedule.label}`)
    setScheduledAt(schedule.frequency === 'once' ? toLocalDateTimeInput(schedule.timeValue) : '')
    operationFeedback.publish({
      action: 'load-schedule',
      tone: 'info',
      title: '计划已载入表单',
      message: `已载入计划「${schedule.label}」到批次表单。`,
      toast: true
    })
  }, [addToast, applyTemplate, templates])

  const triggerScheduleNow = useCallback(async (schedule: ProjectTaskSchedule) => {
    if (!currentProject) return
    setIsSubmitting(true)
    setLogExpanded(true)
    clearLogs()
    summaryKeyRef.current = null
    closureKeyRef.current = null
    operationFeedback.start('trigger-schedule', '正在触发计划', `正在立即触发计划「${schedule.label}」。`)
    try {
      const result = await platformAPI.invoke(
        IPC.PIPELINE_TRIGGER_SCHEDULE,
        currentProject.id,
        schedule.id
      ) as { success?: boolean; error?: string; runs?: PipelineRunRecord[] }
      if (!result.success || !result.runs) {
        operationFeedback.fail('trigger-schedule', '计划触发失败', result.error || '计划触发失败')
        return
      }
      trackQueuedRuns(result.runs)
      operationFeedback.succeed('trigger-schedule', '计划已触发', `计划「${schedule.label}」已立即触发，${result.runs.length} 集进入队列`, false)
      addToast('success', `计划「${schedule.label}」已立即触发，${result.runs.length} 集进入队列`)
    } catch (error) {
      operationFeedback.fail('trigger-schedule', '计划触发失败', error instanceof Error ? error.message : '计划触发失败')
    } finally {
      setIsSubmitting(false)
    }
  }, [addToast, clearLogs, currentProject, operationFeedback, trackQueuedRuns])

  const submitTemplateFromShortcut = useCallback(async (template: ProjectTaskTemplate) => {
    setSelectedTemplateId(template.id)
    applyTemplate(template)
    await submitBatchPlan({
      selectedTemplate: template,
      batchLabel: `${template.label} · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    })
  }, [applyTemplate, submitBatchPlan])

  const handleStop = useCallback(() => {
    void (async () => {
      operationFeedback.start('stop-batch', '正在停止批次', '正在取消排队任务并尝试停止当前执行。')
      await platformAPI.invoke(IPC.PIPELINE_ABORT, {
        batchId: trackedBatchId || undefined,
        reason: '批量任务已手动终止'
      })

      await refreshTrackedRuns()
      operationFeedback.warn('stop-batch', '已请求停止当前批次', '队列中的待执行任务已尝试取消，运行中的任务已发送停止请求。', false)
      addToast('warning', '已请求停止当前批次')
    })()
  }, [addToast, operationFeedback, refreshTrackedRuns, trackedBatchId])

  return (
    <div className="batch-page">
      {!embedded && <h2>🚀 批量执行</h2>}
      <OperationStatusBanner feedback={operationFeedback.feedback} onDismiss={operationFeedback.clear} />
      {isWebPreview && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--color-warning)' }}>
          <strong>{hasRemoteRuntime ? '网页远程批量执行' : '网页预览模式'}</strong>
          <p className="text-secondary" style={{ margin: '8px 0 0' }}>
            {hasRemoteRuntime
              ? '当前批量页面已连接远程后端。你可以直接提交批次、触发计划、轮询队列，并在页面内观察运行日志。'
              : '当前浏览器本地模式只能保留批次表单和浏览页面结构；真实队列、计划触发和运行控制需要切换到远程 HTTP 或桌面端。'}
          </p>
        </div>
      )}

      {lastClosureSnapshot && (
        <div className="batch-closure-card card">
          <div className="task-run-list-header">
            <h3>最近批次闭环摘要</h3>
            <span className="text-secondary text-xs">{lastClosureSnapshot.batchLabel}</span>
          </div>
          <div className="batch-preview-grid">
            <div className="batch-preview-card">
              <span className="task-summary-label">任务数</span>
              <strong>{lastClosureSnapshot.summary.total}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">已完成</span>
              <strong>{lastClosureSnapshot.summary.completed}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">失败</span>
              <strong>{lastClosureSnapshot.summary.failed}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">摘要文件</span>
              <strong>{lastClosureSnapshot.reportPath.split('/').pop()}</strong>
            </div>
          </div>
          <div className="batch-template-hint text-secondary">{lastClosureSnapshot.reportPath}</div>
          <div className="batch-shortcut-actions">
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  if (!currentProject || !trackedBatchId) return
                  const runs = await platformAPI.invoke(
                    IPC.PIPELINE_LIST_RUNS,
                    currentProject.id,
                    Math.max(120, trackedRootRunIds.length * 12),
                    true
                  ) as PipelineRunRecord[]
                  const latestRuns = pickLatestPipelineRuns(runs.filter((run) => run.batchId === trackedBatchId))
                  const snapshot = await exportClosureReport(latestRuns, lastClosureSnapshot.batchLabel)
                  if (snapshot) {
                    operationFeedback.succeed('batch-closure', '任务闭环摘要已更新', `批次摘要已写入 ${snapshot.reportPath}`)
                  }
                } catch (error) {
                  operationFeedback.fail('batch-closure', '任务闭环摘要更新失败', error instanceof Error ? error.message : String(error))
                }
              }}
            >
              重新导出摘要
            </button>
          </div>
        </div>
      )}

      {pipelineRunning && (
        <div className="batch-bg-banner" style={{
          padding: '12px 16px',
          marginBottom: '12px',
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ color: 'var(--color-accent)' }}>
            后台正在处理 <strong>EP{String(pipelineContext?.episodeNum ?? 0).padStart(3, '0')}</strong>，新批次会按优先级进入队列。
          </span>
          <button className="btn btn-danger btn-sm" onClick={async () => {
            operationFeedback.start('stop-engine', '正在停止后台任务', '正在向当前执行中的流水线发送停止请求。')
            const success = await stopPipeline()
            if (success) {
              operationFeedback.warn('stop-engine', '后台任务已停止', '当前执行中的流水线已停止。', false)
            } else {
              operationFeedback.fail('stop-engine', '停止后台任务失败', '当前执行中的流水线停止失败。', false)
            }
            addToast(success ? 'warning' : 'error', success ? '后台任务已停止' : '停止后台任务失败')
          }}>
            ⏹ 停止当前任务
          </button>
        </div>
      )}

      {enginePaused && (
        <div className="batch-bg-banner" style={{
          padding: '12px 16px',
          marginBottom: '12px',
          background: 'rgba(234, 179, 8, 0.1)',
          border: '1px solid rgba(234, 179, 8, 0.3)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ color: 'var(--color-warning)' }}>
            队列当前暂停在 <strong>EP{String(pipelineContext?.episodeNum ?? 0).padStart(3, '0')}</strong>，恢复后才会继续处理后续任务。
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-sm" onClick={async () => {
              operationFeedback.start('resume-engine', '正在恢复后台任务', '正在恢复当前暂停中的流水线。')
              const success = await resumePipeline()
              if (success) {
                operationFeedback.succeed('resume-engine', '后台任务正在恢复', '后台流水线已收到恢复请求。', false)
              } else {
                operationFeedback.fail('resume-engine', '恢复后台任务失败', '后台流水线恢复失败。', false)
              }
              addToast(success ? 'info' : 'error', success ? '后台任务正在恢复' : '恢复后台任务失败')
            }}>
              ▶ 恢复
            </button>
            <button className="btn btn-danger btn-sm" onClick={async () => {
              operationFeedback.start('stop-engine', '正在停止后台任务', '正在向当前执行中的流水线发送停止请求。')
              const success = await stopPipeline()
              if (success) {
                operationFeedback.warn('stop-engine', '后台任务已停止', '当前执行中的流水线已停止。', false)
              } else {
                operationFeedback.fail('stop-engine', '停止后台任务失败', '当前执行中的流水线停止失败。', false)
              }
              addToast(success ? 'warning' : 'error', success ? '后台任务已停止' : '停止后台任务失败')
            }}>
              ⏹ 停止当前任务
            </button>
          </div>
        </div>
      )}

      <div className="batch-mode-bar">
        {Object.entries(MODE_MAP).map(([key, config]) => (
          <button
            key={key}
            className={`btn batch-mode-btn ${mode === key ? 'active' : ''}`}
            onClick={() => setMode(key as BatchMode)}
          >
            {config.emoji} {config.label}
          </button>
        ))}
      </div>

      {templates.length > 0 && (
        <div className="batch-quick-panel card">
          <div className="task-run-list-header">
            <h3>模板快捷启动</h3>
            <span className="text-secondary text-xs">直接把模板实例化为批次。</span>
          </div>
          <div className="batch-shortcut-grid">
            {templates.map((template) => (
              <div key={template.id} className="batch-shortcut-card">
                <strong>[{getTemplateSourceLabel(template)}] {template.label}</strong>
                <span className="text-secondary">{template.description || `${getTemplateExecutionLabel(template)} · ${template.batchMode}`}</span>
                <div className="batch-shortcut-actions">
                  <button className="btn btn-sm" onClick={() => {
                    setSelectedTemplateId(template.id)
                    applyTemplate(template)
                    operationFeedback.publish({
                      action: 'load-template',
                      tone: 'info',
                      title: '模板已载入表单',
                      message: `已载入模板「${template.label}」。`,
                      toast: true
                    })
                  }}>
                    载入表单
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => void submitTemplateFromShortcut(template)} disabled={selectedEps.size === 0 || isSubmitting}>
                    按当前选集提交
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {schedules.length > 0 && (
        <div className="batch-quick-panel card">
          <div className="task-run-list-header">
            <h3>计划实例化</h3>
            <span className="text-secondary text-xs">把自动化计划直接载入或立即触发。</span>
          </div>
          <div className="batch-shortcut-grid">
            {schedules.map((schedule) => {
              const occurrence = resolveScheduleOccurrence(schedule)
              const template = templates.find((item) => item.id === schedule.templateId) || null
              return (
                <div key={schedule.id} className="batch-shortcut-card">
                  <strong>{schedule.label}</strong>
                  <span className="text-secondary">
                    {schedule.frequency === 'daily' ? `每日 ${schedule.timeValue}` : `一次性 ${new Date(schedule.timeValue).toLocaleString('zh-CN')}`}
                  </span>
                  <span className="text-secondary">
                    {schedule.episodeNumbers.length} 集 · {template ? template.label : '默认策略'}
                  </span>
                  <span className="text-secondary">
                    {occurrence ? `当前已到自动触发窗口：${new Date(occurrence.scheduledAt).toLocaleString('zh-CN')}` : '当前未到自动触发窗口，可手动立即执行'}
                  </span>
                  <div className="batch-shortcut-actions">
                    <button className="btn btn-sm" onClick={() => applyScheduleToForm(schedule)}>
                      载入表单
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={() => void triggerScheduleNow(schedule)} disabled={isSubmitting}>
                      立即触发
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="batch-strategy card">
        <div className="batch-strategy-grid">
          <div className="form-group">
            <label>批次名称</label>
            <input
              className="input"
              value={batchLabel}
              onChange={(event) => setBatchLabel(event.target.value)}
              placeholder="例如：首批回填 / 高优先级修复"
            />
          </div>
          <div className="form-group">
            <label>任务模板</label>
            <select
              className="input"
              value={selectedTemplateId}
              onChange={(event) => {
                const nextId = event.target.value
                setSelectedTemplateId(nextId)
                applyTemplate(templates.find((item) => item.id === nextId) || null)
              }}
            >
              <option value="">不使用模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  [{getTemplateSourceLabel(template)}] {template.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>优先级</label>
            <select className="input" value={priority} onChange={(event) => setPriority(event.target.value as PipelineRunPriority)}>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>自动重试</label>
            <select className="input" value={maxAutoRetries} onChange={(event) => setMaxAutoRetries(Number(event.target.value))}>
              <option value={0}>不自动重试</option>
              <option value={1}>失败后重试 1 次</option>
              <option value={2}>失败后重试 2 次</option>
              <option value={3}>失败后重试 3 次</option>
            </select>
          </div>
          <div className="form-group">
            <label>编排模式</label>
            <select className="input" value={batchMode} onChange={(event) => setBatchMode(event.target.value as PipelineBatchMode)}>
              <option value="independent">独立并排队</option>
              <option value="sequential_on_success">串行，前一集成功后继续</option>
              <option value="sequential_always">串行，无论成功失败都继续</option>
            </select>
          </div>
          <div className="form-group">
            <label>定时开始</label>
            <input
              className="input"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </div>
        </div>
        {selectedTemplate && (
          <div className="batch-template-hint text-secondary">
            当前模板：[{getTemplateSourceLabel(selectedTemplate)}] {selectedTemplate.label} · {getTemplateExecutionLabel(selectedTemplate)} · {selectedTemplate.batchMode}
            {selectedTemplate.description ? ` · ${selectedTemplate.description}` : ''}
          </div>
        )}
        {scheduledAt && (
          <div className="batch-template-hint text-secondary">
            该批次会先入队，预计在 {new Date(scheduledAt).toLocaleString('zh-CN')} 后自动释放执行。
          </div>
        )}
        {batchPreview && (
          <div className="batch-preview-grid">
            <div className="batch-preview-card">
              <span className="task-summary-label">计划任务数</span>
              <strong>{batchPreview.requests.length}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">执行阶段</span>
              <strong>{batchPreview.startStage ? MODE_MAP[mode].label : '全流程'}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">依赖模式</span>
              <strong>{batchMode}</strong>
            </div>
            <div className="batch-preview-card">
              <span className="task-summary-label">定时释放</span>
              <strong>{batchPreview.scheduledAtIso ? new Date(batchPreview.scheduledAtIso).toLocaleString('zh-CN') : '立即'}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="batch-selection">
        <div className="batch-selection-header">
          <span className="text-secondary">
            已选 {selectedEps.size} / {episodes.length} 集
          </span>
          <div className="batch-quick-actions">
            <button className="btn btn-sm" onClick={selectAll}>
              {selectedEps.size === episodes.length ? '取消全选' : '全选'}
            </button>
            <button className="btn btn-sm" onClick={() => selectRange(1, 10)}>1-10</button>
            <button className="btn btn-sm" onClick={() => selectRange(11, 20)}>11-20</button>
            <button className="btn btn-sm" onClick={() => selectRange(21, 30)}>21-30</button>
          </div>
        </div>
        <div className="episode-select-grid">
          {episodes.map((ep) => (
            <button
              key={ep.id}
              className={`episode-select-btn ${selectedEps.has(ep.episodeNumber) ? 'selected' : ''} ${ep.status === 'complete' ? 'completed' : ''}`}
              onClick={() => toggleEpisode(ep.episodeNumber)}
            >
              <span className="ep-num">{String(ep.episodeNumber).padStart(3, '0')}</span>
              {ep.status === 'complete' && <span className="ep-done">✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="batch-actions">
        {!activeBatch ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={handleBatchRun}
            disabled={selectedEps.size === 0 || isSubmitting}
          >
            ▶ 提交 {selectedEps.size} 集到策略队列
          </button>
        ) : (
          <button
            className="btn btn-danger btn-lg"
            onClick={handleStop}
          >
            ⏹ 停止当前批次
          </button>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="batch-progress">
          <h3 className="section-title">批次进度</h3>
          <div className="batch-task-list">
            {tasks.map((task) => (
              <div key={task.rootRunId} className={`batch-task task-${task.status}`}>
                <span className="task-ep">EP{String(task.episodeNum).padStart(3, '0')}</span>
                <span className="task-status-icon">
                  {task.status === 'queued' && '⏳'}
                  {task.status === 'running' && '🔄'}
                  {task.status === 'paused' && '⏸'}
                  {task.status === 'completed' && '✅'}
                  {task.status === 'failed' && '❌'}
                  {task.status === 'aborted' && '⏭'}
                  {task.status === 'dead_letter' && '🧯'}
                </span>
                <span className="task-progress text-secondary">
                  {task.progress}
                </span>
                <span className="task-meta-chip">{task.priority}</span>
                <span className="task-meta-chip">尝试 {task.attempt + 1}/{task.maxAutoRetries + 1}</span>
                {task.status === 'queued' && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await platformAPI.invoke(IPC.PIPELINE_CANCEL_RUN, task.runId)
                      await refreshTrackedRuns()
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(activeBatch || logs.length > 0) && (
        <div className={`batch-log-panel ${logExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="batch-log-header" onClick={() => setLogExpanded(!logExpanded)}>
            <span className="batch-log-title">
              📋 执行日志
              {pipelineRunning && <span className="log-running-dot" />}
              <span className="batch-log-count">{logs.length} 条</span>
            </span>
            <div className="batch-log-actions">
              <button
                className="btn btn-sm batch-log-clear-btn"
                onClick={(event) => {
                  event.stopPropagation()
                  clearLogs()
                }}
                title="清空日志"
              >
                🗑
              </button>
              <span className="batch-log-toggle">{logExpanded ? '▼' : '▶'}</span>
            </div>
          </div>
          {logExpanded && (
            <div className="batch-log-body" ref={logBodyRef} onScroll={handleLogScroll}>
              {logs.length === 0 ? (
                <div className="log-empty text-secondary">等待队列中的任务开始执行...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-entry log-${log.level}`}>
                    <span className="log-icon">{getLogIcon(log.level, log.eventType)}</span>
                    <span className="log-ep-tag">{log.episodeId}</span>
                    <span className="log-time">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
              {streamBuffer && pipelineRunning && (
                <div className="log-stream">
                  <span className="log-icon">🤖</span>
                  <span className="log-stream-text">生成中... ({streamBuffer.length} chars)</span>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
