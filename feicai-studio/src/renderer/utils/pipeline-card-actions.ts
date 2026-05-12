import type { AutomatedPipelineStage } from '@shared/types'
import {
  resolveWorkflowCardActionSpec,
  type WorkflowActionId,
  type WorkflowCard,
  type WorkflowCardActionIntent,
  type WorkflowCardActionMeta,
  type WorkflowCardActionSpecParams
} from '@renderer/utils/pipeline-view'

export function buildWorkflowRoutePaths(
  projectId: string | undefined,
  episodeNum: number
) {
  if (!projectId) {
    return {
      sourcePath: undefined,
      storyPath: undefined,
      storyReviewPath: undefined,
      scriptPath: undefined,
      reviewPath: undefined,
      assetsPath: undefined,
      pipelinePath: undefined,
      promptBasePath: undefined
    }
  }

  const ep = episodeNum
  return {
    sourcePath: `/project/${projectId}/source`,
    storyPath: `/project/${projectId}/story?ep=${ep}`,
    storyReviewPath: `/project/${projectId}/review?ep=${ep}&stage=story_review`,
    scriptPath: `/project/${projectId}/script?ep=${ep}`,
    reviewPath: `/project/${projectId}/review?ep=${ep}`,
    assetsPath: `/project/${projectId}/assets`,
    pipelinePath: `/project/${projectId}/pipeline?ep=${ep}`,
    promptBasePath: `/project/${projectId}/prompts?ep=${ep}`
  }
}

export function resolveWorkflowCardActionMeta(params: {
  card: WorkflowCard
  specParams: Omit<WorkflowCardActionSpecParams, 'cardId'>
  navigate: (path: string) => void
  onWorkflowAction: (stage: WorkflowActionId) => void
  onAutomationAction: (
    stage?: AutomatedPipelineStage,
    singleStage?: boolean
  ) => void
}): WorkflowCardActionMeta {
  const { card, specParams, navigate, onWorkflowAction, onAutomationAction } =
    params
  const spec = resolveWorkflowCardActionSpec({
    ...specParams,
    cardId: card.id
  })

  const toAction = (intent: WorkflowCardActionIntent) => {
    if (intent.type === 'navigate') {
      return () => {
        if (intent.path) navigate(intent.path)
      }
    }
    if (intent.type === 'workflow') {
      return () => onWorkflowAction(intent.stage)
    }
    return () => onAutomationAction(intent.stage, intent.singleStage)
  }

  return {
    openLabel: spec.openLabel,
    openPath: spec.openPath,
    primaryLabel: spec.primaryLabel,
    primaryDisabled: spec.primaryDisabled,
    primaryAction: toAction(spec.primaryIntent),
    secondaryLabel: spec.secondaryLabel,
    secondaryDisabled: spec.secondaryDisabled,
    secondaryAction: spec.secondaryIntent
      ? toAction(spec.secondaryIntent)
      : undefined
  }
}
