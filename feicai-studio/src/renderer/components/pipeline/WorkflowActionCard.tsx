import { memo } from 'react'
import type { WorkflowActionId } from '@renderer/utils/pipeline-view'
import type { WorkflowActionCardViewModel } from './workflow-action-panel-config'

interface Props {
  card: WorkflowActionCardViewModel
  workflowAction: WorkflowActionId | null
  displayIsRunning: boolean
  canStart: boolean
  onAction: (stage: WorkflowActionId) => void
}

function WorkflowActionCard(props: Props) {
  const { card, workflowAction, displayIsRunning, canStart, onAction } = props

  return (
    <div className="card workflow-action-card">
      <div className="workflow-action-top">
        <span className="workflow-action-badge">{card.badge}</span>
        <strong>{card.title}</strong>
      </div>
      <p className="text-secondary">{card.description}</p>
      <span className={`workflow-action-state ${card.stateClassName}`}>
        {card.stateLabel}
      </span>
      <button
        className="btn"
        onClick={() => onAction(card.id)}
        disabled={displayIsRunning || workflowAction !== null || !canStart}
      >
        {workflowAction === card.id ? '执行中...' : card.actionLabel}
      </button>
    </div>
  )
}

export default memo(WorkflowActionCard)
