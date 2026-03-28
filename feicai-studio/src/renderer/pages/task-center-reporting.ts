import type { PipelineRunRecord, PipelineRuntimeDiagnostics } from '@shared/types'
import { formatTelemetryDurationMs, formatTelemetryTokens, formatTelemetryUsd } from './pipeline-telemetry-format'

export interface PipelineRunSummaryStats {
  total: number
  queued: number
  running: number
  paused: number
  completed: number
  failed: number
  aborted: number
  deadLetter: number
}

function formatReportDate(value?: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN')
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

function sanitizeFileSlug(input?: string): string {
  const normalized = (input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'scope'
}

export function pickLatestPipelineRuns(runs: PipelineRunRecord[]): PipelineRunRecord[] {
  const latest = new Map<string, PipelineRunRecord>()
  for (const run of runs) {
    const existing = latest.get(run.rootRunId)
    if (!existing) {
      latest.set(run.rootRunId, run)
      continue
    }

    if (run.attempt > existing.attempt) {
      latest.set(run.rootRunId, run)
      continue
    }

    if (run.attempt === existing.attempt && run.lastUpdatedAt > existing.lastUpdatedAt) {
      latest.set(run.rootRunId, run)
    }
  }

  return [...latest.values()].sort((a, b) => a.episodeNum - b.episodeNum)
}

export function summarizePipelineRuns(runs: PipelineRunRecord[]): PipelineRunSummaryStats {
  return {
    total: runs.length,
    queued: runs.filter((run) => run.status === 'queued').length,
    running: runs.filter((run) => run.status === 'running').length,
    paused: runs.filter((run) => run.status === 'paused').length,
    completed: runs.filter((run) => run.status === 'completed').length,
    failed: runs.filter((run) => run.status === 'failed').length,
    aborted: runs.filter((run) => run.status === 'aborted').length,
    deadLetter: runs.filter((run) => run.status === 'dead_letter').length
  }
}

function summarizeRunTelemetry(runs: PipelineRunRecord[]): {
  callCount: number
  totalTokens: number
  estimatedCostUsd: number
  totalDurationMs: number
} {
  return runs.reduce((summary, run) => {
    summary.callCount += run.telemetry?.callCount || 0
    summary.totalTokens += run.telemetry?.totalTokens || 0
    summary.estimatedCostUsd += run.telemetry?.estimatedCostUsd || 0
    summary.totalDurationMs += run.telemetry?.totalDurationMs || 0
    return summary
  }, {
    callCount: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    totalDurationMs: 0
  })
}

export function buildPipelineClosureReport(input: {
  projectName: string
  generatedAt: string
  scopeLabel: string
  scopeType: 'batch' | 'schedule' | 'project' | 'run'
  runs: PipelineRunRecord[]
}): string {
  const { projectName, generatedAt, scopeLabel, scopeType, runs } = input
  const stats = summarizePipelineRuns(runs)
  const episodeList = [...new Set(runs.map((run) => run.episodeNum))].sort((a, b) => a - b)
  const successRate = stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : '--'
  const telemetry = summarizeRunTelemetry(runs)
  const lines = [
    '# 任务闭环摘要',
    '',
    `- 项目：${projectName}`,
    `- 范围：${scopeLabel}`,
    `- 范围类型：${scopeType}`,
    `- 生成时间：${formatReportDate(generatedAt)}`,
    `- 覆盖任务数：${stats.total}`,
    `- 覆盖集数：${episodeList.length > 0 ? episodeList.map((episode) => `EP${String(episode).padStart(3, '0')}`).join(', ') : '--'}`,
    `- 成功率：${successRate}`,
    `- LLM 调用：${telemetry.callCount}`,
    `- 累计 Token：${formatTelemetryTokens(telemetry.totalTokens)}`,
    `- 预估成本：${formatTelemetryUsd(telemetry.estimatedCostUsd)}`,
    '',
    '## 汇总',
    '',
    `- 排队中：${stats.queued}`,
    `- 执行中：${stats.running}`,
    `- 已暂停：${stats.paused}`,
    `- 已完成：${stats.completed}`,
    `- 失败：${stats.failed}`,
    `- 已中止：${stats.aborted}`,
    `- 死信：${stats.deadLetter}`,
    '',
    '## 任务明细',
    ''
  ]

  for (const run of runs) {
    lines.push(`### EP${String(run.episodeNum).padStart(3, '0')} · ${run.currentStage} · ${run.status}`)
    lines.push('')
    lines.push(`- Run ID：${run.runId}`)
    lines.push(`- 优先级：${run.priority}`)
    lines.push(`- 尝试次数：${run.attempt + 1}/${run.maxAutoRetries + 1}`)
    lines.push(`- 排队时间：${formatReportDate(run.queuedAt)}`)
    lines.push(`- 启动时间：${formatReportDate(run.startedAt)}`)
    lines.push(`- 结束时间：${formatReportDate(run.endedAt)}`)
    lines.push(`- 执行耗时：${formatRunDuration(run)}`)
    if (run.batchLabel) lines.push(`- 批次：${run.batchLabel}`)
    if (run.templateLabel) lines.push(`- 模板：${run.templateLabel}`)
    if (run.scheduleLabel) lines.push(`- 调度：${run.scheduleLabel}`)
    if (run.automationKey) lines.push(`- 自动化键：${run.automationKey}`)
    if (run.dependsOnRootRunId) lines.push(`- 前置依赖：${run.dependsOnRootRunId}`)
    if (run.scheduledAt) lines.push(`- 计划时间：${formatReportDate(run.scheduledAt)}`)
    lines.push(`- LLM 调用：${run.telemetry?.callCount || 0}`)
    lines.push(`- Token：${formatTelemetryTokens(run.telemetry?.totalTokens || 0)}`)
    lines.push(`- 成本：${formatTelemetryUsd(run.telemetry?.estimatedCostUsd || 0)}`)
    lines.push(`- LLM 耗时：${formatTelemetryDurationMs(run.telemetry?.totalDurationMs || 0)}`)
    if (run.telemetry?.lastProvider || run.telemetry?.lastModel) lines.push(`- 最近模型：${run.telemetry?.lastProvider || '--'} / ${run.telemetry?.lastModel || '--'}`)
    if (run.telemetry?.lastFailureClass) lines.push(`- 最近失败分类：${run.telemetry.lastFailureClass}`)
    if (run.errorMessage) lines.push(`- 错误：${run.errorMessage}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export function buildAutomationAuditReport(input: {
  projectName: string
  generatedAt: string
  includeArchived: boolean
  runs: PipelineRunRecord[]
}): string {
  const { projectName, generatedAt, includeArchived, runs } = input
  const telemetry = summarizeRunTelemetry(runs)
  const lines = [
    '# 自动化审计报告',
    '',
    `- 项目：${projectName}`,
    `- 生成时间：${formatReportDate(generatedAt)}`,
    `- 覆盖任务数：${runs.length}`,
    `- 包含已归档：${includeArchived ? '是' : '否'}`,
    `- LLM 调用：${telemetry.callCount}`,
    `- 累计 Token：${formatTelemetryTokens(telemetry.totalTokens)}`,
    `- 预估成本：${formatTelemetryUsd(telemetry.estimatedCostUsd)}`,
    '',
    '## 摘要',
    '',
    `- 排队中：${runs.filter((run) => run.status === 'queued').length}`,
    `- 执行中：${runs.filter((run) => run.status === 'running' || run.status === 'paused').length}`,
    `- 已完成：${runs.filter((run) => run.status === 'completed').length}`,
    `- 失败：${runs.filter((run) => run.status === 'failed').length}`,
    `- 已中止：${runs.filter((run) => run.status === 'aborted').length}`,
    `- 死信：${runs.filter((run) => run.status === 'dead_letter').length}`,
    '',
    '## 任务明细',
    ''
  ]

  for (const run of runs) {
    lines.push(`### EP${String(run.episodeNum).padStart(3, '0')} · ${run.currentStage} · ${run.status}`)
    lines.push('')
    lines.push(`- Run ID：${run.runId}`)
    lines.push(`- 优先级：${run.priority}`)
    lines.push(`- 尝试次数：${run.attempt + 1}/${run.maxAutoRetries + 1}`)
    lines.push(`- 排队时间：${formatReportDate(run.queuedAt)}`)
    lines.push(`- 启动时间：${formatReportDate(run.startedAt)}`)
    lines.push(`- 结束时间：${formatReportDate(run.endedAt)}`)
    lines.push(`- 执行耗时：${formatRunDuration(run)}`)
    if (run.batchLabel) lines.push(`- 批次：${run.batchLabel}`)
    if (run.templateLabel) lines.push(`- 模板：${run.templateLabel}`)
    if (run.scheduleLabel) lines.push(`- 调度：${run.scheduleLabel}`)
    if (run.automationKey) lines.push(`- 自动化键：${run.automationKey}`)
    if (run.dependsOnRootRunId) lines.push(`- 前置依赖：${run.dependsOnRootRunId}`)
    if (run.scheduledAt) lines.push(`- 计划时间：${formatReportDate(run.scheduledAt)}`)
    lines.push(`- LLM 调用：${run.telemetry?.callCount || 0}`)
    lines.push(`- Token：${formatTelemetryTokens(run.telemetry?.totalTokens || 0)}`)
    lines.push(`- 成本：${formatTelemetryUsd(run.telemetry?.estimatedCostUsd || 0)}`)
    if (run.telemetry?.lastFailureClass) lines.push(`- 最近失败分类：${run.telemetry.lastFailureClass}`)
    if (run.errorMessage) lines.push(`- 错误：${run.errorMessage}`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

export function buildAutomationAuditFileName(now = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `automation-audit-${yyyy}${mm}${dd}-${hh}${mi}.md`
}

export function buildAutomationReportOutputPath(projectPath: string, fileName: string): string {
  return `${projectPath.replace(/\/+$/, '')}/outputs/automation-reports/${fileName}`
}

export function buildPipelineClosureFileName(scopeLabel: string, now = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `pipeline-closure-${yyyy}${mm}${dd}-${hh}${mi}-${sanitizeFileSlug(scopeLabel)}.md`
}

export function buildDiagnosticsSnapshotFileName(now = new Date()): string {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  return `runtime-diagnostics-${yyyy}${mm}${dd}-${hh}${mi}.json`
}

export function serializeDiagnosticsSnapshot(diagnostics: PipelineRuntimeDiagnostics): string {
  return `${JSON.stringify(diagnostics, null, 2)}\n`
}
