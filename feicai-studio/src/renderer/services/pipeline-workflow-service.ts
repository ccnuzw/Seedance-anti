import {
  runCharacterDesign,
  runScriptGeneration,
  runScriptReview,
  runStoryboardReview,
  runStoryReview,
  runStoryGeneration
} from '@renderer/services/workflow-actions'
import { executeWorkflowAction } from '@renderer/utils/workflow-action-result'
import type { Project, ReviewResult } from '@shared/types'
import type {
  WorkflowActionId,
  WorkflowActionResult,
  StageAvailability
} from '@renderer/utils/pipeline-view'

const ACTION_LABELS: Record<WorkflowActionId, string> = {
  story: '剧情批次拆解',
  story_review: '剧情批次审核',
  script: '剧本生成',
  script_review: '剧本审核',
  character: '角色设计',
  storyboard_review: '分镜审核'
}

const ACTION_MAP: Record<WorkflowActionId, typeof runStoryGeneration> = {
  story: runStoryGeneration,
  story_review: runStoryReview,
  script: runScriptGeneration,
  script_review: runScriptReview,
  character: runCharacterDesign,
  storyboard_review: runStoryboardReview
}

export interface ExecutePipelineWorkflowActionParams {
  project: Project
  episodeNum: number
  stage: WorkflowActionId
  availability: StageAvailability
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string,
    options?: number | { title?: string; duration?: number }
  ) => void
  syncEpisodeStatus: () => Promise<unknown>
  setReviewFeedback: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  setWorkflowReport: (value: WorkflowActionResult | null) => void
}

export async function executePipelineWorkflowAction(
  params: ExecutePipelineWorkflowActionParams
): Promise<WorkflowActionResult> {
  const {
    project,
    episodeNum,
    stage,
    availability,
    addToast,
    syncEpisodeStatus,
    setReviewFeedback,
    setWorkflowReport
  } = params

  if (!availability.canStart) {
    addToast('error', availability.reason)
    return { stage, success: false, error: availability.reason }
  }

  let actionResult: WorkflowActionResult = {
    stage,
    success: false,
    error: `${ACTION_LABELS[stage]}执行失败`
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await ACTION_MAP[stage]({
        projectPath: project.projectPath,
        episodeNum,
        projectName: project.name,
        visualStyle: project.visualStyle,
        targetMedium: project.targetMedium
      })
      actionResult = { ...result, stage }
      return actionResult
    },
    successMessage: `${ACTION_LABELS[stage]}已完成`,
    reviewFailureMessage: (review) =>
      `${ACTION_LABELS[stage]}未通过，评分 ${review.score}/10`,
    errorFallbackMessage: `${ACTION_LABELS[stage]}执行失败`,
    addToast: (type, message) => addToast(type, message),
    onResult: async (result) => {
      setWorkflowReport(result)
    },
    onReview: async (review) => {
      setReviewFeedback(project.projectPath, episodeNum, review)
    },
    syncOnSuccess: async () => {
      await syncEpisodeStatus()
    }
  })

  return actionResult
}

export function getPipelineWorkflowStageLabel(stage: WorkflowActionId): string {
  return ACTION_LABELS[stage]
}
