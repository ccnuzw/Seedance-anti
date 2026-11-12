import { useNovelProductionReadiness } from './useNovelProductionReadiness'
import { getNovelProductionReadiness } from '@renderer/utils/novel-production-readiness'
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
  const novelState = useNovelProductionReadiness(
    entryStage === 'novel' ? currentProject : null
  )
  const novelReadiness = useMemo(
    () =>
      getNovelProductionReadiness({
        ...novelState,
        projectId: currentProject?.id,
        episodeNumber: episodeNum,
        episode: currentEpisode
      }),
    [
      novelState.hasSource,
      novelState.waterline,
      currentProject?.id,
      episodeNum,
      currentEpisode
    ]
  )
  const { hasSourceNovel: summaryHasSource, workflowSummaries } =
    useWorkflowSummaries(currentProject, currentEpisode, episodeNum)

  const hasSourceNovel =
    entryStage === 'novel' ? novelState.hasSource === true : summaryHasSource
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
        hasSourceNovel,
        novelReadiness
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
    [currentEpisode, entryStage, hasSourceNovel, novelReadiness]
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
      }).map((card) => {
        if (entryStage !== 'novel') return card
        if (card.id === 'novel' && novelState.hasSource === null)
          return { ...card, state: 'blocked', note: novelReadiness.reason }
        if (card.id === 'story' || card.id === 'story_review')
          return {
            ...card,
            state: (currentEpisode?.hasScript ||
            novelReadiness.action === 'script'
              ? 'done'
              : card.id === 'story_review'
                ? 'skipped'
                : 'blocked') as WorkflowCard['state'],
            note: novelReadiness.reason
          }
        if (card.id === 'script' && !currentEpisode?.hasScript)
          return {
            ...card,
            state: (novelReadiness.canStart
              ? 'ready'
              : 'blocked') as WorkflowCard['state'],
            note: novelReadiness.reason
          }
        return card
      }),
    [
      currentEpisode,
      entryStage,
      displayState,
      displayIsRunning,
      workflowSummaries,
      hasSourceNovel,
      novelReadiness,
      novelState.hasSource
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
      workflowCards.map((card) => {
        if (
          entryStage === 'novel' &&
          card.id === 'novel' &&
          novelState.hasSource === null
        )
          return [
            card.id,
            {
              primaryLabel: '刷新准备状态',
              primaryDisabled: busyWorkflow || busyPipeline,
              primaryAction: () => {
                void Promise.all([
                  novelState.refresh(),
                  syncEpisodeStatus()
                ]).catch(() => addToast('error', '状态读取失败，请重试'))
              }
            }
          ]
        if (
          entryStage === 'novel' &&
          (card.id === 'story' ||
            card.id === 'story_review' ||
            (card.id === 'script' && !novelReadiness.canStart))
        ) {
          const path =
            novelReadiness.action === 'source'
              ? routePaths.sourcePath
              : novelReadiness.action === 'script'
                ? routePaths.scriptPath
                : routePaths.storyPath
          return [
            card.id,
            {
              openLabel: '查看剧情',
              openPath: path,
              primaryLabel: novelReadiness.label,
              primaryDisabled: busyWorkflow || busyPipeline,
              primaryAction: () => {
                if (novelReadiness.action === 'refresh')
                  void Promise.all([
                    novelState.refresh(),
                    syncEpisodeStatus()
                  ]).catch(() => addToast('error', '状态读取失败，请重试'))
                else if (path) navigate(path)
              }
            }
          ]
        }
        return [
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
        ]
      })
    ) as Record<WorkflowCard['id'], WorkflowCardActionMeta>
  }, [
    syncEpisodeStatus,
    addToast,
    entryStage,
    novelReadiness,
    novelState.hasSource,
    novelState.refresh,
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
