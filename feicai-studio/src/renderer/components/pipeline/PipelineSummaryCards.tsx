import { memo } from 'react'
import { DevProfiler } from '@renderer/dev/render-profiler'

interface PipelineSummaryCardsProps {
  entryLabel: string
  workflowMode: string
  currentStageLabel: string
  progress: number
  automationReady: boolean
  automationGate?: string
}

function PipelineSummaryCards(props: PipelineSummaryCardsProps) {
  const {
    entryLabel,
    workflowMode,
    currentStageLabel,
    progress,
    automationReady,
    automationGate
  } = props

  return (
    <DevProfiler id="PipelineSummaryCards">
      <div className="pipeline-summary-grid">
        <div className="card pipeline-summary-card">
          <span className="pipeline-summary-label">项目入口</span>
          <strong>{entryLabel}</strong>
          <span className="text-secondary">工作流模式：{workflowMode}</span>
        </div>
        <div className="card pipeline-summary-card">
          <span className="pipeline-summary-label">当前阶段</span>
          <strong>{currentStageLabel}</strong>
          <span className="text-secondary">流程进度 {progress}%</span>
        </div>
        <div className="card pipeline-summary-card">
          <span className="pipeline-summary-label">自动执行门槛</span>
          <strong>{automationReady ? '已开放' : '未开放'}</strong>
          <span className="text-secondary">
            {automationGate || '等待前置产物'}
          </span>
        </div>
      </div>
    </DevProfiler>
  )
}

export default memo(PipelineSummaryCards)
