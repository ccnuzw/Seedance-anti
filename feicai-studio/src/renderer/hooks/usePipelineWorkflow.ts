import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  AutomatedPipelineStage,
  Episode,
  PipelineState,
  Project,
  ReviewResult
} from '@shared/types'
import { normalizeProjectConfig } from '@shared/project-config'
import {
  buildPipelineEdges,
  buildPipelineNodes,
  buildWorkflowCards,
  getFlowCardClass,
  getStageAvailability,
  getWorkflowActionAvailability,
  type AutomatedStageAvailabilityMap,
  type WorkflowActionId,
  type WorkflowActionResult,
  type WorkflowAvailabilityMap,
  type WorkflowCard,
  type WorkflowCardActionMeta
} from '@renderer/utils/pipeline-view'
import { useWorkflowSummaries } from '@renderer/hooks/useWorkflowSummaries'
import { usePipelineWorkflowActions } from '@renderer/hooks/usePipelineWorkflowActions'
import {
  buildWorkflowRoutePaths,
  resolveWorkflowCardActionMeta
} from '@renderer/utils/pipeline-card-actions'

interface StageTiming {
  stage: AutomatedPipelineStage
  startedAt: number
  endedAt?: number
  elapsed: number
}

interface UsePipelineWorkflowParams {
  currentProject: Project | null
  currentEpisode: Episode | undefined
  episodeNum: number
  displayState: PipelineState
  displayIsRunning: boolean
  displayTimings: StageTiming[]
  displayCurrentStage: AutomatedPipelineStage | null
  stageElapsed: number
  isEngineMatch: boolean
  isRunning: boolean
  contextReviews: ReviewResult[]
  workflowAction: WorkflowActionId | null
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
  handleStart: (
    stage?: AutomatedPipelineStage,
    singleStage?: boolean
  ) => Promise<void>
}

export function usePipelineWorkflow(params: UsePipelineWorkflowParams) {
  const {
    currentProject,
    currentEpisode,
    episodeNum,
    displayState,
    displayIsRunning,
    displayTimings,
    displayCurrentStage,
    stageElapsed,
    isEngineMatch,
    isRunning,
    contextReviews,
    workflowAction,
    setWorkflowAction,
    setWorkflowReport,
    syncEpisodeStatus,
    setReviewFeedback,
    addToast,
    handleStart
  } = params

  const navigate = useNavigate()
  const projectConfig = normalizeProjectConfig(currentProject?.config)
  const entryStage = projectConfig.entryStage || 'novel'
  const { hasSourceNovel, workflowSummaries } = useWorkflowSummaries(
    currentProject,
    currentEpisode,
    episodeNum
  )

  const stageAvailability: AutomatedStageAvailabilityMap = useMemo(
    () => ({
      director: getStageAvailability(currentEpisode, 'director'),
      art: getStageAvailability(currentEpisode, 'art'),
      storyboard: getStageAvailability(currentEpisode, 'storyboard')
    }),
    [currentEpisode]
  )

  const workflowAvailability: WorkflowAvailabilityMap = useMemo(
    () => ({
      story: getWorkflowActionAvailability(
        currentEpisode,
        'story',
        entryStage,
        hasSourceNovel
      ),
      script: getWorkflowActionAvailability(
        currentEpisode,
        'script',
        entryStage,
        hasSourceNovel
      ),
      story_review: getWorkflowActionAvailability(
        currentEpisode,
        'story_review',
        entryStage,
        hasSourceNovel
      ),
      script_review: getWorkflowActionAvailability(
        currentEpisode,
        'script_review',
        entryStage,
        hasSourceNovel
      ),
      character: getWorkflowActionAvailability(
        currentEpisode,
        'character',
        entryStage,
        hasSourceNovel
      ),
      storyboard_review: getWorkflowActionAvailability(
        currentEpisode,
        'storyboard_review',
        entryStage,
        hasSourceNovel
      )
    }),
    [currentEpisode, entryStage, hasSourceNovel]
  )

  const workflowCards: WorkflowCard[] = useMemo(
    () =>
      buildWorkflowCards({
        episode: currentEpisode,
        entryStage,
        displayState,
        displayIsRunning,
        summaryMap: workflowSummaries,
        hasSourceNovel
      }),
    [
      currentEpisode,
      entryStage,
      displayState,
      displayIsRunning,
      workflowSummaries,
      hasSourceNovel
    ]
  )

  const nodes = useMemo(
    () =>
      buildPipelineNodes({
        displayState,
        displayTimings,
        displayCurrentStage,
        stageElapsed,
        isEngineMatch,
        reviews: contextReviews,
        currentEpisode
      }),
    [
      displayState,
      displayTimings,
      displayCurrentStage,
      stageElapsed,
      isEngineMatch,
      contextReviews,
      currentEpisode
    ]
  )

  const edges = useMemo(() => buildPipelineEdges(displayState), [displayState])

  const handleWorkflowAction = usePipelineWorkflowActions({
    currentProject,
    episodeNum,
    workflowAvailability,
    setWorkflowAction,
    setWorkflowReport,
    syncEpisodeStatus,
    setReviewFeedback,
    addToast
  })

  const routePaths = useMemo(
    () => buildWorkflowRoutePaths(currentProject?.id, episodeNum),
    [currentProject?.id, episodeNum]
  )

  const workflowCardActionMetaMap = useMemo(() => {
    const busyWorkflow = displayIsRunning || workflowAction !== null
    const busyPipeline = isRunning
    return Object.fromEntries(
      workflowCards.map((card) => [
        card.id,
        resolveWorkflowCardActionMeta({
          card,
          specParams: {
            currentEpisode,
            hasSourceNovel,
            workflowAvailability,
            stageAvailability,
            busyWorkflow,
            busyPipeline,
            paths: routePaths
          },
          navigate,
          onWorkflowAction: handleWorkflowAction,
          onAutomationAction: (stage, singleStage) => {
            void handleStart(stage, singleStage)
          }
        })
      ])
    ) as Record<WorkflowCard['id'], WorkflowCardActionMeta>
  }, [
    workflowCards,
    currentEpisode,
    displayIsRunning,
    workflowAction,
    isRunning,
    hasSourceNovel,
    workflowAvailability,
    stageAvailability,
    routePaths,
    navigate,
    handleWorkflowAction,
    handleStart
  ])

  const getWorkflowCardActionMeta = useCallback(
    (card: WorkflowCard): WorkflowCardActionMeta =>
      workflowCardActionMetaMap[card.id],
    [workflowCardActionMetaMap]
  )

  return {
    projectConfig,
    entryStage,
    hasSourceNovel,
    workflowSummaries,
    workflowCards,
    workflowCardActionMetaMap,
    stageAvailability,
    workflowAvailability,
    nodes,
    edges,
    handleWorkflowAction,
    getWorkflowCardActionMeta,
    getFlowCardClass
  }
}
