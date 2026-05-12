import { memo } from 'react'
import type {
  AutomatedStageAvailabilityMap,
  WorkflowAvailabilityMap
} from '@renderer/utils/pipeline-view'

interface PrerequisiteGridProps {
  workflowAvailability: WorkflowAvailabilityMap
  stageAvailability: AutomatedStageAvailabilityMap
}

function PrerequisiteGrid(props: PrerequisiteGridProps) {
  const { workflowAvailability, stageAvailability } = props

  return (
    <div className="pipeline-prereq-grid">
      <div className="card prereq-card">
        <span className="prereq-title">剧情拆解前置</span>
        <strong>
          {workflowAvailability.story.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.story.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">剧情审核前置</span>
        <strong>
          {workflowAvailability.story_review.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.story_review.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">剧本生成前置</span>
        <strong>
          {workflowAvailability.script.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.script.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">剧本审核前置</span>
        <strong>
          {workflowAvailability.script_review.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.script_review.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">角色设计前置</span>
        <strong>
          {workflowAvailability.character.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.character.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">分镜审核前置</span>
        <strong>
          {workflowAvailability.storyboard_review.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {workflowAvailability.storyboard_review.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">导演前置</span>
        <strong>
          {stageAvailability.director.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {stageAvailability.director.reason}
        </span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">服化道前置</span>
        <strong>{stageAvailability.art.canStart ? '满足' : '未满足'}</strong>
        <span className="text-secondary">{stageAvailability.art.reason}</span>
      </div>
      <div className="card prereq-card">
        <span className="prereq-title">分镜前置</span>
        <strong>
          {stageAvailability.storyboard.canStart ? '满足' : '未满足'}
        </strong>
        <span className="text-secondary">
          {stageAvailability.storyboard.reason}
        </span>
      </div>
    </div>
  )
}

export default memo(PrerequisiteGrid)
