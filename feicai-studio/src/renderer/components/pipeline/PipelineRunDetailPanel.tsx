import { memo } from 'react'
import {
  formatFailureClass,
  formatRunStatus,
  formatRunTime,
  getLogIcon
} from '@renderer/components/pipeline/pipelineWorkspaceView'
import {
  formatTelemetryDurationMs,
  formatTelemetryTokens,
  formatTelemetryUsd
} from '@renderer/pages/pipeline-telemetry-format'
import type { LogEntry, PipelineLLMCallRecord, PipelineRunRecord } from '@shared/types'

interface PipelineRunDetailPanelProps {
  selectedRun: PipelineRunRecord | null
  selectedRunLogs: LogEntry[]
  selectedRunLLMCalls: PipelineLLMCallRecord[]
  runDetailLoading: boolean
}

function PipelineRunDetailPanel({
  selectedRun,
  selectedRunLogs,
  selectedRunLLMCalls,
  runDetailLoading
}: PipelineRunDetailPanelProps) {
  if (!selectedRun) return null

  return (
    <div className="pipeline-run-detail card">
      <div className={`pipeline-run-detail-loading-badge ${runDetailLoading ? 'is-visible' : ''}`} aria-live="polite">
        <span className="pipeline-run-detail-loading-dot" aria-hidden="true" />
        <span>详情同步中</span>
      </div>
      <div className="pipeline-run-detail-header">
        <div>
          <h3>任务详情</h3>
          <div className="pipeline-run-detail-meta">
            <span>EP{String(selectedRun.episodeNum).padStart(3, '0')}</span>
            <span>{formatRunStatus(selectedRun.status)}</span>
            <span>{selectedRun.currentStage}</span>
            <span>{selectedRun.singleStage ? '单阶段' : '全流程'}</span>
            <span>{selectedRun.priority}</span>
            <span>尝试 {selectedRun.attempt + 1}/{selectedRun.maxAutoRetries + 1}</span>
            {selectedRun.batchLabel && <span>{selectedRun.batchLabel}</span>}
            <span>排队 {formatRunTime(selectedRun.queuedAt)}</span>
            {selectedRun.startedAt && <span>启动 {formatRunTime(selectedRun.startedAt)}</span>}
            {selectedRun.endedAt && <span>结束 {formatRunTime(selectedRun.endedAt)}</span>}
            <span>LLM {selectedRun.telemetry?.callCount || 0}</span>
            <span>Token {formatTelemetryTokens(selectedRun.telemetry?.totalTokens || 0)}</span>
            <span>成本 {formatTelemetryUsd(selectedRun.telemetry?.estimatedCostUsd || 0)}</span>
          </div>
        </div>
      </div>

      {selectedRun.errorMessage && (
        <div className="pipeline-run-error">
          {selectedRun.errorMessage}
        </div>
      )}

      <div className="pipeline-run-telemetry-grid">
        <div className="pipeline-run-telemetry-card">
          <span>LLM 总耗时</span>
          <strong>{formatTelemetryDurationMs(selectedRun.telemetry?.totalDurationMs || 0)}</strong>
        </div>
        <div className="pipeline-run-telemetry-card">
          <span>成功 / 失败</span>
          <strong>{selectedRun.telemetry?.successCount || 0} / {selectedRun.telemetry?.failureCount || 0}</strong>
        </div>
        <div className="pipeline-run-telemetry-card">
          <span>最近模型</span>
          <strong>{selectedRun.telemetry?.lastProvider || '--'} / {selectedRun.telemetry?.lastModel || '--'}</strong>
        </div>
        <div className="pipeline-run-telemetry-card">
          <span>失败分类</span>
          <strong>{formatFailureClass(selectedRun.telemetry?.lastFailureClass)}</strong>
        </div>
      </div>

      <div className="pipeline-run-detail-content">
        <section className="pipeline-run-detail-section">
          <div className="pipeline-run-detail-section-header">
            <h4>LLM 调用遥测</h4>
            <span className="text-secondary text-xs">{selectedRunLLMCalls.length} 条</span>
          </div>
          <div className="pipeline-run-llm-calls">
            {selectedRunLLMCalls.length === 0 ? (
              <div className="log-empty text-secondary">当前任务暂无 LLM 调用遥测。</div>
            ) : (
              selectedRunLLMCalls.map((call) => (
                <div key={call.id} className={`pipeline-run-llm-call is-${call.status}`}>
                  <div className="pipeline-run-llm-call-top">
                    <strong>{call.stage} · {call.phase === 'stage_execution' ? '执行' : call.phase === 'business_review' ? '业务审核' : '合规审核'}</strong>
                    <span>{call.status === 'success' ? '成功' : `失败 · ${formatFailureClass(call.failureClass)}`}</span>
                  </div>
                  <div className="pipeline-run-meta">
                    <span>{call.provider} / {call.model}</span>
                    <span>{call.stream ? '流式' : '非流式'}</span>
                    <span>耗时 {formatTelemetryDurationMs(call.durationMs)}</span>
                    <span>Token {formatTelemetryTokens(call.usage?.totalTokens || 0)}</span>
                    <span>成本 {formatTelemetryUsd(call.estimatedCostUsd || 0)}</span>
                    <span>{formatRunTime(call.startedAt)}</span>
                  </div>
                  {call.errorMessage && <div className="pipeline-run-llm-call-error">{call.errorMessage}</div>}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="pipeline-run-detail-section">
          <div className="pipeline-run-detail-section-header">
            <h4>执行日志</h4>
            <span className="text-secondary text-xs">{selectedRunLogs.length} 条</span>
          </div>
          <div className="pipeline-run-detail-logs">
            {selectedRunLogs.length === 0 ? (
              <div className="log-empty text-secondary">
                {selectedRun.status === 'queued' ? '任务还未开始执行。' : '当前任务暂无持久化日志。'}
              </div>
            ) : (
              selectedRunLogs.map((log) => (
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
        </section>
      </div>
    </div>
  )
}

export default memo(PipelineRunDetailPanel)
