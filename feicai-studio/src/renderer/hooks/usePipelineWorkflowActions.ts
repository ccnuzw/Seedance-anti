import { useCallback } from 'react'
import type { Project, ReviewResult } from '@shared/types'
import { executePipelineWorkflowAction } from '@renderer/services/pipeline-workflow-service'
import type {
  WorkflowActionId,
  WorkflowActionResult,
  WorkflowAvailabilityMap
} from '@renderer/utils/pipeline-view'

interface UsePipelineWorkflowActionsParams {
  currentProject: Project | null
  episodeNum: number
  workflowAvailability: WorkflowAvailabilityMap
  setWorkflowAction: (value: WorkflowActionId | null) => void
  setWorkflowReport: (value: WorkflowActionResult | null) => void
  syncEpisodeStatus: () => Promise<unknown>
  setReviewFeedback: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string,
    options?: number | { title?: string; duration?: number }
  ) => void
}

export function usePipelineWorkflowActions(
  params: UsePipelineWorkflowActionsParams
) {
  const {
    currentProject,
    episodeNum,
    workflowAvailability,
    setWorkflowAction,
    setWorkflowReport,
    syncEpisodeStatus,
    setReviewFeedback,
    addToast
  } = params

  return useCallback(
    async (stage: WorkflowActionId) => {
      if (!currentProject) return
      const availability = workflowAvailability[stage]

      setWorkflowAction(stage)
      setWorkflowReport(null)

      await executePipelineWorkflowAction({
        project: currentProject,
        episodeNum,
        stage,
        availability,
        addToast,
        syncEpisodeStatus,
        setReviewFeedback,
        setWorkflowReport
      })
      setWorkflowAction(null)
    },
    [
      currentProject,
      episodeNum,
      workflowAvailability,
      setWorkflowAction,
      setWorkflowReport,
      syncEpisodeStatus,
      setReviewFeedback,
      addToast
    ]
  )
}
