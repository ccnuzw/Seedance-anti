import { memo, useMemo } from 'react'
import type { Episode } from '@shared/types'
import type {
  WorkflowActionId,
  WorkflowActionResult,
  WorkflowAvailabilityMap
} from '@renderer/utils/pipeline-view'
import { DevProfiler } from '@renderer/dev/render-profiler'
import WorkflowActionCard from './WorkflowActionCard'
import WorkflowActionReportCard from './WorkflowActionReportCard'
import { buildWorkflowActionCards } from './workflow-action-panel-config'

interface WorkflowActionPanelProps {
  currentEpisode: Episode | undefined
  workflowAvailability: WorkflowAvailabilityMap
  workflowAction: WorkflowActionId | null
  workflowReport: WorkflowActionResult | null
  displayIsRunning: boolean
  onAction: (stage: WorkflowActionId) => void
}

function WorkflowActionPanel(props: WorkflowActionPanelProps) {
  const {
    currentEpisode,
    workflowAvailability,
    workflowAction,
    workflowReport,
    displayIsRunning,
    onAction
  } = props

  const cards = useMemo(
    () => buildWorkflowActionCards(currentEpisode, workflowAvailability),
    [currentEpisode, workflowAvailability]
  )

  return (
    <DevProfiler id="WorkflowActionPanel">
      <>
        <div className="pipeline-section-header">
          <div>
            <h3>源头与审核执行</h3>
            <p className="text-secondary">
              这里补上剧情拆解、剧本生成、剧本审核、角色设计、分镜审核五个独立阶段。从剧本起步的项目会自动跳过前两步。
            </p>
          </div>
        </div>

        <div className="workflow-actions-grid">
          {cards.map((card) => (
            <WorkflowActionCard
              key={card.id}
              card={card}
              workflowAction={workflowAction}
              displayIsRunning={displayIsRunning}
              canStart={workflowAvailability[card.id]?.canStart ?? false}
              onAction={onAction}
            />
          ))}
        </div>

        {workflowReport && <WorkflowActionReportCard report={workflowReport} />}
      </>
    </DevProfiler>
  )
}

export default memo(WorkflowActionPanel)
