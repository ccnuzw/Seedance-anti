import { describe, expect, it } from 'vitest'
import type { PipelineRunRecord, PipelineRuntimeDiagnostics } from '@shared/types'
import {
  buildAutomationAuditReport,
  buildAutomationAuditFileName,
  buildAutomationReportOutputPath,
  buildDiagnosticsSnapshotFileName,
  buildPipelineClosureFileName,
  buildPipelineClosureReport,
  pickLatestPipelineRuns,
  serializeDiagnosticsSnapshot
} from './task-center-reporting'

describe('task-center-reporting', () => {
  const runs: PipelineRunRecord[] = [
    {
      runId: 'run-1',
      projectId: 'project-1',
      projectPath: '/tmp/project-1',
      episodeNum: 1,
      currentStage: 'director',
      status: 'completed',
      state: 'episode_complete',
      singleStage: false,
      queuedAt: '2026-03-24T01:00:00.000Z',
      startedAt: '2026-03-24T01:01:00.000Z',
      endedAt: '2026-03-24T01:03:30.000Z',
      lastUpdatedAt: '2026-03-24T01:03:30.000Z',
      priority: 'high',
      maxAutoRetries: 2,
      attempt: 1,
      rootRunId: 'root-1',
      triggerCondition: 'always',
      batchLabel: '批次一',
      templateLabel: '导演补跑',
      scheduleLabel: '每日回填',
      automationKey: 'project-1:sch-1:daily:2026-03-24:ep1',
      telemetry: {
        callCount: 3,
        successCount: 3,
        failureCount: 0,
        totalDurationMs: 18000,
        inputTokens: 1800,
        outputTokens: 700,
        totalTokens: 2500,
        estimatedCostUsd: 0.0042,
        lastProvider: 'openai',
        lastModel: 'gpt-4o-mini',
        lastCalledAt: '2026-03-24T01:03:20.000Z'
      }
    },
    {
      runId: 'run-2',
      projectId: 'project-1',
      projectPath: '/tmp/project-1',
      episodeNum: 2,
      currentStage: 'art',
      status: 'failed',
      state: 'error',
      singleStage: true,
      queuedAt: '2026-03-24T02:00:00.000Z',
      lastUpdatedAt: '2026-03-24T02:10:00.000Z',
      priority: 'normal',
      maxAutoRetries: 1,
      attempt: 0,
      rootRunId: 'root-2',
      triggerCondition: 'on_success',
      errorMessage: '模型超时',
      telemetry: {
        callCount: 2,
        successCount: 1,
        failureCount: 1,
        totalDurationMs: 9000,
        inputTokens: 900,
        outputTokens: 200,
        totalTokens: 1100,
        estimatedCostUsd: 0.0011,
        lastProvider: 'anthropic',
        lastModel: 'claude-3-5-sonnet',
        lastFailureClass: 'timeout',
        lastCalledAt: '2026-03-24T02:09:55.000Z'
      }
    }
  ]

  it('builds markdown audit reports with summary and run metadata', () => {
    const report = buildAutomationAuditReport({
      projectName: '示例项目',
      generatedAt: '2026-03-24T03:00:00.000Z',
      includeArchived: false,
      runs
    })

    expect(report).toContain('# 自动化审计报告')
    expect(report).toContain('- 项目：示例项目')
    expect(report).toContain('- 已完成：1')
    expect(report).toContain('- 失败：1')
    expect(report).toContain('- 模板：导演补跑')
    expect(report).toContain('- LLM 调用：5')
    expect(report).toContain('- 成本：$0.001100')
    expect(report).toContain('- 错误：模型超时')
  })

  it('builds deterministic diagnostics snapshot filenames', () => {
    expect(buildDiagnosticsSnapshotFileName(new Date(2026, 2, 24, 8, 5, 0)))
      .toBe('runtime-diagnostics-20260324-0805.json')
  })

  it('builds deterministic audit filenames and output paths', () => {
    expect(buildAutomationAuditFileName(new Date(2026, 2, 24, 8, 5, 0)))
      .toBe('automation-audit-20260324-0805.md')
    expect(buildPipelineClosureFileName('批次一 / Director', new Date(2026, 2, 24, 8, 5, 0)))
      .toBe('pipeline-closure-20260324-0805-director.md')
    expect(buildAutomationReportOutputPath('/tmp/project-1/', 'automation-audit-20260324-0805.md'))
      .toBe('/tmp/project-1/outputs/automation-reports/automation-audit-20260324-0805.md')
  })

  it('builds pipeline closure reports with unified summary', () => {
    const report = buildPipelineClosureReport({
      projectName: '示例项目',
      generatedAt: '2026-03-24T03:00:00.000Z',
      scopeLabel: '批次一',
      scopeType: 'batch',
      runs
    })

    expect(report).toContain('# 任务闭环摘要')
    expect(report).toContain('- 范围：批次一')
    expect(report).toContain('- 已完成：1')
    expect(report).toContain('- 已暂停：0')
    expect(report).toContain('- 成功率：50%')
    expect(report).toContain('- 预估成本：$0.005300')
  })

  it('picks the latest run per root run id', () => {
    const latestRuns = pickLatestPipelineRuns([
      runs[0],
      {
        ...runs[0],
        runId: 'run-1-retry',
        status: 'failed',
        attempt: 2,
        lastUpdatedAt: '2026-03-24T01:05:00.000Z'
      },
      runs[1]
    ])

    expect(latestRuns).toHaveLength(2)
    expect(latestRuns[0]?.runId).toBe('run-1-retry')
    expect(latestRuns[1]?.runId).toBe('run-2')
  })

  it('serializes diagnostics snapshots as json with trailing newline', () => {
    const diagnostics: PipelineRuntimeDiagnostics = {
      generatedAt: '2026-03-24T03:00:00.000Z',
      activeRun: null,
      queue: [],
      queueSummary: {
        total: 0,
        waitingForSchedule: 0,
        waitingForDependency: 0,
        deadLetter: 0
      },
      automation: {
        projectCount: 1,
        enabledScheduleCount: 2
      },
      recovery: {
        deadLetterCount: 0,
        orphanedRunCount: 0
      },
      telemetry: {
        runCount: 1,
        callCount: 5,
        successCount: 4,
        failureCount: 1,
        totalDurationMs: 27000,
        totalTokens: 3600,
        estimatedCostUsd: 0.0053
      },
      issues: []
    }

    const output = serializeDiagnosticsSnapshot(diagnostics)
    expect(output).toContain('"enabledScheduleCount": 2')
    expect(output).toContain('"callCount": 5')
    expect(output.endsWith('\n')).toBe(true)
  })
})
