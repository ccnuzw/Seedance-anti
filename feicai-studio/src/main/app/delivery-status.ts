import { BrowserWindow, app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppDeliveryIssue, AppDeliveryStatus } from '@shared/types'
import { getRuntimeLogsDir, getRuntimeLogPath, getRecentRuntimeErrors, logRuntimeEvent } from './runtime-logging'
import { getDatabaseFilePath } from '../db/database'
import { listLLMConfigs, listProjects } from '../db/queries'
import { getPipelineManager } from '../ipc/pipeline-handlers'

function getReportsDir(): string {
  const dir = join(app.getPath('userData'), 'reports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function buildIssues(input: {
  llmConfigCount: number
  defaultLLMCount: number
  projectCount: number
  deadLetterCount: number
  queuedRunCount: number
  recentErrors: ReturnType<typeof getRecentRuntimeErrors>
}): AppDeliveryIssue[] {
  const issues: AppDeliveryIssue[] = []

  if (input.llmConfigCount === 0) {
    issues.push({
      severity: 'error',
      code: 'llm.missing',
      message: '尚未配置任何 LLM，应用当前不具备可交付生产能力。'
    })
  } else if (input.defaultLLMCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'llm.default_missing',
      message: '已配置模型，但未设置默认 LLM；部分流程可能在运行前缺少明确模型来源。'
    })
  }

  if (input.projectCount === 0) {
    issues.push({
      severity: 'info',
      code: 'project.empty',
      message: '当前还没有项目，适合先做首个交付样例工程。'
    })
  }

  if (input.deadLetterCount > 0) {
    issues.push({
      severity: 'warning',
      code: 'pipeline.dead_letter',
      message: `当前存在 ${input.deadLetterCount} 个死信任务，正式交付前应先回收或归档。`
    })
  }

  if (input.queuedRunCount > 0) {
    issues.push({
      severity: 'info',
      code: 'pipeline.queue',
      message: `当前队列中仍有 ${input.queuedRunCount} 个任务，建议在导出交付包前确认状态。`
    })
  }

  if (input.recentErrors.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'runtime.recent_errors',
      message: `最近运行日志中存在 ${input.recentErrors.length} 条错误记录，建议先导出诊断并排查。`
    })
  }

  return issues
}

export function getAppDeliveryStatus(): AppDeliveryStatus {
  const projects = listProjects()
  const llmConfigs = listLLMConfigs()
  const defaultLLMCount = llmConfigs.filter((item) => item.category === 'llm' && item.isDefault).length
  const runtimeDiagnostics = getPipelineManager().getDiagnostics()
  const recentErrors = getRecentRuntimeErrors()
  const issues = buildIssues({
    llmConfigCount: llmConfigs.length,
    defaultLLMCount,
    projectCount: projects.length,
    deadLetterCount: runtimeDiagnostics.queueSummary.deadLetter,
    queuedRunCount: runtimeDiagnostics.queueSummary.total,
    recentErrors
  })

  const errorCount = issues.filter((item) => item.severity === 'error').length
  const warningCount = issues.filter((item) => item.severity === 'warning').length
  const score = Math.max(0, 100 - errorCount * 35 - warningCount * 12)

  return {
    generatedAt: new Date().toISOString(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    paths: {
      userData: app.getPath('userData'),
      database: getDatabaseFilePath(),
      logsDir: getRuntimeLogsDir(),
      runtimeLog: getRuntimeLogPath(),
      reportsDir: getReportsDir()
    },
    readiness: {
      score,
      issueCount: errorCount,
      warningCount,
      llmConfigCount: llmConfigs.length,
      defaultLLMCount,
      projectCount: projects.length,
      readyForDelivery: errorCount === 0
    },
    runtime: {
      openWindowCount: BrowserWindow.getAllWindows().length,
      activeRunId: runtimeDiagnostics.activeRun?.runId,
      queuedRunCount: runtimeDiagnostics.queueSummary.total,
      deadLetterCount: runtimeDiagnostics.queueSummary.deadLetter,
      automationEnabledCount: runtimeDiagnostics.automation.enabledScheduleCount,
      telemetryCallCount: runtimeDiagnostics.telemetry.callCount
    },
    recentErrors: recentErrors.map((entry) => ({
      timestamp: entry.timestamp,
      scope: entry.scope,
      message: entry.message
    })),
    issues
  }
}

export function exportAppDeliveryReport(): { filePath: string; status: AppDeliveryStatus } {
  const status = getAppDeliveryStatus()
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const filePath = join(getReportsDir(), `delivery-status-${yyyy}${mm}${dd}-${hh}${mi}.json`)
  writeFileSync(filePath, `${JSON.stringify(status, null, 2)}\n`, 'utf-8')
  logRuntimeEvent({
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'runtime',
    message: `delivery report exported: ${filePath}`
  })
  return { filePath, status }
}
