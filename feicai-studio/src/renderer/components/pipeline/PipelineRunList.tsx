import { memo } from 'react'
import { formatRunStatus, formatRunTime } from '@renderer/components/pipeline/pipelineWorkspaceView'
import { formatTelemetryUsd } from '@renderer/pages/pipeline-telemetry-format'
import type { PipelineRunRecord } from '@shared/types'

interface PipelineRunListProps {
  runs: PipelineRunRecord[]
  selectedRunId: string | null
  currentRunId?: string | null
  onSelectRun: (runId: string) => void
}

function PipelineRunList({
  runs,
  selectedRunId,
  currentRunId,
  onSelectRun
}: PipelineRunListProps) {
  if (runs.length === 0) return null

  return (
    <div className="pipeline-runs card">
      <div className="pipeline-runs-header">
        <h3>最近运行</h3>
        <span className="text-secondary text-xs">按启动时间倒序</span>
      </div>
      <div className="pipeline-runs-list">
        {runs.map((run) => {
          const isCurrentRun = run.runId === currentRunId
          return (
            <div
              key={run.runId}
              className={`pipeline-run-item ${isCurrentRun ? 'is-current' : ''} ${selectedRunId === run.runId ? 'is-selected' : ''}`}
              onClick={() => onSelectRun(run.runId)}
            >
              <div className="pipeline-run-main">
                <div className="pipeline-run-title">
                  <strong>EP{String(run.episodeNum).padStart(3, '0')}</strong>
                  <span className={`pipeline-run-status status-${run.status}`}>{formatRunStatus(run.status)}</span>
                </div>
                <div className="pipeline-run-meta">
                  <span>{run.currentStage}</span>
                  <span>{run.singleStage ? '单阶段' : '全流程'}</span>
                  <span>{run.priority}</span>
                  <span>尝试 {run.attempt + 1}/{run.maxAutoRetries + 1}</span>
                  {run.batchLabel && <span>{run.batchLabel}</span>}
                  {run.telemetry?.callCount ? <span>LLM {run.telemetry.callCount}</span> : null}
                  {run.telemetry?.estimatedCostUsd ? <span>{formatTelemetryUsd(run.telemetry.estimatedCostUsd)}</span> : null}
                  <span>{run.status === 'queued' ? `排队 ${formatRunTime(run.queuedAt)}` : formatRunTime(run.startedAt)}</span>
                  {typeof run.queuePosition === 'number' && <span>队列 #{run.queuePosition}</span>}
                  {run.endedAt && <span>结束 {formatRunTime(run.endedAt)}</span>}
                </div>
              </div>
              <div className="pipeline-run-id">
                {isCurrentRun ? '当前运行' : run.runId.slice(0, 8)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(PipelineRunList)
