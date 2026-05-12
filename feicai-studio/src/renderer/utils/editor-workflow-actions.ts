import { getExceptionMessage } from '@renderer/services/service-contracts'
import {
  executeServiceAction,
  executeWorkflowAction
} from './workflow-action-result'
import type { Project, ReviewResult } from '@shared/types'
import type {
  ServiceWorkflowActionResult,
  ServiceProjectPipelineState,
  ServicePipelineStartResult
} from '@renderer/services/service-contracts'

interface StoryboardReviewDeps {
  runStoryboardReview: (params: {
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
  }) => Promise<ServiceWorkflowActionResult>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<unknown>
  setReviewFeedback: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
}

export async function executeStoryboardReviewAction(
  currentProject: Project,
  currentEp: number,
  deps: StoryboardReviewDeps
): Promise<ServiceWorkflowActionResult> {
  let actionResult: ServiceWorkflowActionResult = {
    success: false,
    error: '分镜审核失败'
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await deps.runStoryboardReview({
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium
      })
      actionResult = result
      return result
    },
    successMessage: `EP${String(currentEp).padStart(2, '0')} 分镜审核已通过`,
    reviewFailureMessage: (review) => `分镜审核未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '分镜审核失败',
    addToast: deps.addToast,
    onReview: async (review) => {
      deps.setReviewFeedback(currentProject.projectPath, currentEp, review)
    },
    syncOnSuccess: async () => {
      await deps.syncSingleEpisodeStatus(currentEp)
    }
  })

  return actionResult
}

interface ScriptReviewDeps {
  runScriptReview: (params: {
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
  }) => Promise<ServiceWorkflowActionResult>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<unknown>
  setReviewFeedback: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
  navigate: (path: string) => void
}

export async function executeScriptReviewAction(
  currentProject: Project,
  currentEp: number,
  deps: ScriptReviewDeps
): Promise<ServiceWorkflowActionResult> {
  let actionResult: ServiceWorkflowActionResult = {
    success: false,
    error: '剧本审核失败'
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await deps.runScriptReview({
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium
      })
      actionResult = result
      return result
    },
    successMessage: `EP${String(currentEp).padStart(2, '0')} 剧本审核已通过`,
    reviewFailureMessage: (review) => `剧本审核未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '剧本审核失败',
    addToast: deps.addToast,
    onReview: async (review) => {
      deps.setReviewFeedback(currentProject.projectPath, currentEp, review)
    },
    syncOnSuccess: async () => {
      await deps.syncSingleEpisodeStatus(currentEp)
    },
    onSuccess: async () => {
      deps.navigate(`/project/${currentProject.id}/pipeline?ep=${currentEp}`)
    }
  })

  return actionResult
}

interface StoryGenerationDeps {
  runStoryGeneration: (params: {
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    reviewFeedback?: string
  }) => Promise<ServiceWorkflowActionResult>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<unknown>
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
  navigate: (path: string) => void
}

export async function executeStoryGenerationAction(
  currentProject: Project,
  targetEpisode: number,
  deps: StoryGenerationDeps,
  options: { reviewFeedback?: string } = {}
): Promise<ServiceWorkflowActionResult> {
  let actionResult: ServiceWorkflowActionResult = {
    success: false,
    error: '剧情拆解执行失败'
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await deps.runStoryGeneration({
        projectPath: currentProject.projectPath,
        episodeNum: targetEpisode,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        reviewFeedback: options.reviewFeedback
      })
      actionResult = result
      return result
    },
    successMessage: `EP${String(targetEpisode).padStart(2, '0')} 剧情拆解已生成`,
    reviewFailureMessage: (review) => `剧情拆解未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '剧情拆解执行失败',
    addToast: deps.addToast,
    syncOnSuccess: async () => {
      await deps.syncSingleEpisodeStatus(targetEpisode)
    },
    onSuccess: async () => {
      deps.navigate(`/project/${currentProject.id}/story?ep=${targetEpisode}`)
    }
  })

  return actionResult
}

interface StoryReviewDeps {
  runStoryReview: (params: {
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
  }) => Promise<ServiceWorkflowActionResult>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<unknown>
  setReviewFeedback: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
}

export async function executeStoryReviewAction(
  currentProject: Project,
  currentEp: number,
  deps: StoryReviewDeps
): Promise<ServiceWorkflowActionResult> {
  let actionResult: ServiceWorkflowActionResult = {
    success: false,
    error: '剧情拆解审核失败'
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await deps.runStoryReview({
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium
      })
      actionResult = result
      return result
    },
    successMessage: `EP${String(currentEp).padStart(2, '0')} 剧情拆解审核已通过`,
    reviewFailureMessage: (review) =>
      `剧情拆解审核未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '剧情拆解审核失败',
    addToast: deps.addToast,
    onReview: async (review) => {
      deps.setReviewFeedback(currentProject.projectPath, currentEp, review)
    },
    syncOnSuccess: async () => {
      await deps.syncSingleEpisodeStatus(currentEp)
    }
  })

  return actionResult
}

interface ScriptGenerationDeps {
  runScriptGeneration: (params: {
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    reviewFeedback?: string
  }) => Promise<ServiceWorkflowActionResult>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<unknown>
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
  navigate: (path: string) => void
}

export async function executeScriptGenerationAction(
  currentProject: Project,
  currentEp: number,
  deps: ScriptGenerationDeps,
  options: { reviewFeedback?: string } = {}
): Promise<ServiceWorkflowActionResult> {
  let actionResult: ServiceWorkflowActionResult = {
    success: false,
    error: '剧本生成失败'
  }

  await executeWorkflowAction({
    execute: async () => {
      const result = await deps.runScriptGeneration({
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        reviewFeedback: options.reviewFeedback
      })
      actionResult = result
      return result
    },
    successMessage: `EP${String(currentEp).padStart(2, '0')} 剧本已生成`,
    reviewFailureMessage: (review) => `剧本生成未通过，评分 ${review.score}/10`,
    errorFallbackMessage: '剧本生成失败',
    addToast: deps.addToast,
    syncOnSuccess: async () => {
      await deps.syncSingleEpisodeStatus(currentEp)
    },
    onSuccess: async () => {
      deps.navigate(`/project/${currentProject.id}/script?ep=${currentEp}`)
    }
  })

  return actionResult
}

interface RegenerateStoryAndReviewDeps
  extends StoryGenerationDeps,
    StoryReviewDeps {
  reloadDocument?: (episodeNum: number) => Promise<unknown>
}

export async function executeRegenerateStoryAndReviewAction(
  currentProject: Project,
  currentEp: number,
  review: ReviewResult,
  deps: RegenerateStoryAndReviewDeps
): Promise<{
  generation: ServiceWorkflowActionResult
  review?: ServiceWorkflowActionResult
}> {
  const generation = await executeStoryGenerationAction(
    currentProject,
    currentEp,
    deps,
    { reviewFeedback: review.feedback }
  )

  if (!generation.success) {
    return { generation }
  }

  await deps.reloadDocument?.(currentEp)
  const nextReview = await executeStoryReviewAction(currentProject, currentEp, deps)
  return { generation, review: nextReview }
}

interface RegenerateScriptAndReviewDeps
  extends ScriptGenerationDeps,
    ScriptReviewDeps {
  reloadDocument?: (episodeNum: number) => Promise<unknown>
}

export async function executeRegenerateScriptAndReviewAction(
  currentProject: Project,
  currentEp: number,
  review: ReviewResult,
  deps: RegenerateScriptAndReviewDeps
): Promise<{
  generation: ServiceWorkflowActionResult
  review?: ServiceWorkflowActionResult
}> {
  const generation = await executeScriptGenerationAction(
    currentProject,
    currentEp,
    deps,
    { reviewFeedback: review.feedback }
  )

  if (!generation.success) {
    return { generation }
  }

  await deps.reloadDocument?.(currentEp)
  const nextReview = await executeScriptReviewAction(currentProject, currentEp, deps)
  return { generation, review: nextReview }
}

interface ReviewHistoryDeps {
  getProjectPipelineState: (
    projectPath: string
  ) => Promise<ServiceProjectPipelineState>
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
}

interface StoryboardReReviewDeps {
  startPipeline: (params: {
    projectId: string
    projectPath: string
    episodeNum: number
    projectName: string
    visualStyle: string
    targetMedium: string
    startStage: 'storyboard'
    singleStage: true
  }) => Promise<ServicePipelineStartResult>
  addToast: (
    type: 'success' | 'error' | 'info' | 'warning',
    message: string
  ) => void
}

export async function loadReviewHistoryAction(
  projectPath: string,
  showToast: boolean,
  deps: ReviewHistoryDeps
): Promise<ServiceProjectPipelineState> {
  try {
    const state = await deps.getProjectPipelineState(projectPath)
    if (showToast) {
      deps.addToast('success', '审核记录已刷新')
    }
    return state
  } catch (error) {
    deps.addToast('error', getExceptionMessage(error, '加载审核历史失败'))
    return null
  }
}

export async function executeStoryboardReReviewAction(
  currentProject: Project,
  currentEp: number,
  deps: StoryboardReReviewDeps
): Promise<ServicePipelineStartResult | undefined> {
  let actionResult: ServicePipelineStartResult | undefined

  await executeServiceAction({
    execute: async () => {
      const result = await deps.startPipeline({
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        episodeNum: currentEp,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        startStage: 'storyboard',
        singleStage: true
      })
      actionResult = result
      return result
    },
    successMessage: '已启动分镜重新审核',
    errorFallbackMessage: '启动审核失败',
    addToast: deps.addToast,
    successToastType: 'info'
  })

  return actionResult
}
