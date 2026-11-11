import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { normalizeProjectConfig } from '@shared/project-config'
import { AUTO_STAGES } from '@renderer/utils/pipeline-view'
import {
  buildStoryPipelineSteps,
  FLOW_STATE_LABELS,
  pickNextWorkflowCard
} from '@renderer/components/pipeline/command-center-view'
import {
  resolvePipelineDisplayState,
  resolvePipelineSummary
} from '@renderer/utils/pipeline-page-view'
import type { AutomatedPipelineStage } from '@shared/types'
import type {
  FlowCardState,
  WorkflowCard,
  WorkflowActionId,
  WorkflowActionResult
} from '@renderer/utils/pipeline-view'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { usePipelineWorkflow } from '@renderer/hooks/usePipelineWorkflow'
import { useElapsedTimer } from '@renderer/hooks/useElapsedTimer'
import { usePipelineNotifications } from '@renderer/hooks/usePipelineNotifications'
import { usePipelineKeyboardShortcuts } from '@renderer/hooks/usePipelineKeyboardShortcuts'
import { usePipelineEventLifecycle } from '@renderer/hooks/usePipelineEventLifecycle'
import { usePipelineEpisodeSync } from '@renderer/hooks/usePipelineEpisodeSync'
import { useShallow } from 'zustand/react/shallow'

export function usePipelinePageController() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [workflowAction, setWorkflowAction] = useState<WorkflowActionId | null>(
    null
  )
  const [workflowReport, setWorkflowReport] =
    useState<WorkflowActionResult | null>(null)
  const [showPrerequisites, setShowPrerequisites] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const {
    state,
    isRunning,
    context,
    setupEventListeners,
    startPipeline,
    stopPipeline,
    retryPipeline,
    skipReviewPipeline,
    pipelineStartedAt,
    stageTimings,
    currentStageName,
    resetDisplay,
    syncFromBackend
  } = usePipelineStore(
    useShallow((s) => ({
      state: s.state,
      isRunning: s.isRunning,
      context: s.context,
      setupEventListeners: s.setupEventListeners,
      startPipeline: s.startPipeline,
      stopPipeline: s.stopPipeline,
      retryPipeline: s.retryPipeline,
      skipReviewPipeline: s.skipReviewPipeline,
      pipelineStartedAt: s.pipelineStartedAt,
      stageTimings: s.stageTimings,
      currentStageName: s.currentStageName,
      resetDisplay: s.resetDisplay,
      syncFromBackend: s.syncFromBackend
    }))
  )

  const urlEp = searchParams.get('ep')
  const episodeNum = parseInt(
    urlEp || (context?.episodeNum ? String(context.episodeNum) : '1')
  )
  const { currentProject, episodes, syncSingleEpisodeStatus } = useProjectStore(
    useShallow((s) => ({
      currentProject: s.currentProject,
      episodes: s.episodes,
      syncSingleEpisodeStatus: s.syncSingleEpisodeStatus
    }))
  )
  const { addToast } = useToastStore()
  const setReviewFeedback = useReviewFeedbackStore((s) => s.setReview)

  const currentEpisode = episodes.find(
    (episode) => episode.episodeNumber === episodeNum
  )
  const projectConfig = normalizeProjectConfig(currentProject?.config)
  const entryStage = projectConfig.entryStage || 'novel'

  const isEngineMatch =
    context?.episodeNum === episodeNum &&
    context?.projectId === currentProject?.id

  const displayState = resolvePipelineDisplayState({
    isEngineMatch,
    engineState: state,
    episodeStatus: currentEpisode?.status
  })
  const displayIsRunning = isEngineMatch ? isRunning : false
  const displayTimings = isEngineMatch ? stageTimings : []
  const displayCurrentStage = isEngineMatch ? currentStageName : null
  const displayStartedAt = isEngineMatch ? pipelineStartedAt : null

  const totalElapsed = useElapsedTimer(displayStartedAt, displayIsRunning)
  const activeStage = displayTimings.find(
    (timing) => timing.stage === displayCurrentStage && !timing.endedAt
  )
  const stageElapsed = useElapsedTimer(
    activeStage?.startedAt || null,
    displayIsRunning && !!activeStage
  )

  usePipelineNotifications({
    state,
    episodeNum,
    isEngineMatch
  })

  const handleNextEpisode = useCallback(() => {
    const nextEp = episodeNum + 1
    const maxEp = currentProject?.totalEpisodes || 30
    if (nextEp <= maxEp) {
      navigate(`/project/${currentProject?.id}/pipeline?ep=${nextEp}`)
    }
  }, [episodeNum, currentProject, navigate])

  const handleSelectEpisode = useCallback(
    (ep: number) => {
      navigate(`/project/${currentProject?.id}/pipeline?ep=${ep}`)
    },
    [currentProject?.id, navigate]
  )

  const launchStage = useCallback(
    async (startStage?: AutomatedPipelineStage, singleStage?: boolean) => {
      if (!currentProject) return
      const stageLabel = startStage
        ? AUTO_STAGES.find((stage) => stage.id === startStage)?.label ||
          startStage
        : '自动执行段'

      const result = await startPipeline({
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        episodeNum,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        startStage,
        singleStage
      })
      if (result.error) {
        addToast('error', result.error)
      } else {
        addToast(
          'info',
          `EP${String(episodeNum).padStart(2, '0')} ${stageLabel}已启动`
        )
      }
    },
    [currentProject, episodeNum, startPipeline, addToast]
  )

  const {
    workflowCards: baseWorkflowCards,
    workflowCardActionMetaMap,
    stageAvailability,
    workflowAvailability,
    nodes,
    edges,
    handleWorkflowAction
  } = usePipelineWorkflow({
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
    contextReviews: context?.reviews || [],
    workflowAction,
    setWorkflowAction,
    setWorkflowReport,
    syncEpisodeStatus: () => syncSingleEpisodeStatus(episodeNum),
    setReviewFeedback,
    addToast,
    handleStart: launchStage
  })

  const workflowCards = useMemo<WorkflowCard[]>(
    () =>
      baseWorkflowCards.map((card) =>
        card.id === workflowAction
          ? {
              ...card,
              state: 'active',
              note: '正在执行当前阶段，请等待任务结束。'
            }
          : card
      ),
    [baseWorkflowCards, workflowAction]
  )

  const automationGate = stageAvailability.director.canStart
    ? '已开放自动执行段'
    : stageAvailability.director.reason

  const summary = resolvePipelineSummary({
    projectConfig,
    episode: currentEpisode,
    automationGate,
    automationReady: stageAvailability.director.canStart
  })

  const handleStart = useCallback(
    async (startStage?: AutomatedPipelineStage, singleStage?: boolean) => {
      const availability = startStage
        ? stageAvailability[startStage]
        : stageAvailability.director
      if (!availability.canStart) {
        addToast('error', availability.reason)
        return
      }
      await launchStage(startStage, singleStage)
    },
    [stageAvailability, addToast, launchStage]
  )

  usePipelineKeyboardShortcuts({
    isRunning,
    canStart: !!currentProject,
    onStart: () => {
      void handleStart()
    },
    onStop: () => {
      void stopPipeline()
    }
  })

  usePipelineEventLifecycle(setupEventListeners)

  usePipelineEpisodeSync({
    episodeNum,
    resetDisplay,
    syncFromBackend
  })

  const handleStop = useCallback(() => {
    void stopPipeline()
    addToast('warning', '流水线已停止')
  }, [stopPipeline, addToast])

  const handleSkipReview = useCallback(() => {
    void skipReviewPipeline()
    addToast('info', '已跳过当前阶段审核')
  }, [skipReviewPipeline, addToast])

  const handleRetry = useCallback(() => {
    void retryPipeline()
    addToast('info', '正在重试流水线...')
  }, [retryPipeline, addToast])

  const maxEpisodes = currentProject?.totalEpisodes || 30
  const runningEpisodeNum =
    isRunning && context?.projectId === currentProject?.id
      ? context?.episodeNum
      : undefined
  const shouldShowCompletionBanner = currentEpisode
    ? ['complete', 'episode_complete'].includes(currentEpisode.status)
    : false

  const togglePrerequisites = useCallback(() => {
    setShowPrerequisites((value) => !value)
  }, [])

  const toggleLogs = useCallback(() => {
    setShowLogs((value) => !value)
  }, [])

  const toggleAdvanced = useCallback(() => {
    setShowAdvanced((value) => !value)
  }, [])

  const openWorkflowPath = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate]
  )

  const triggerWorkflowAction = useCallback(
    (stage: WorkflowActionId) => {
      void handleWorkflowAction(stage)
    },
    [handleWorkflowAction]
  )

  const triggerStart = useCallback(
    (stage?: AutomatedPipelineStage, singleStage?: boolean) => {
      void handleStart(stage, singleStage)
    },
    [handleStart]
  )

  const storyPipelineSteps = useMemo(
    () =>
      buildStoryPipelineSteps({
        entryStage,
        episode: currentEpisode,
        cards: workflowCards,
        actionMetaMap: workflowCardActionMetaMap,
        onOpen: openWorkflowPath
      }),
    [
      entryStage,
      currentEpisode,
      workflowCards,
      workflowCardActionMetaMap,
      openWorkflowPath
    ]
  )

  const nextWorkflowCard = useMemo(
    () => pickNextWorkflowCard(workflowCards),
    [workflowCards]
  )

  const nextActionMeta = nextWorkflowCard
    ? workflowCardActionMetaMap[nextWorkflowCard.id]
    : null

  const nextStep = useMemo(() => {
    if (displayIsRunning) {
      const activeCard =
        workflowCards.find((card) => card.state === 'active') ||
        nextWorkflowCard
      return {
        label: activeCard?.label || '等待当前任务完成',
        status: '执行中',
        reason:
          activeCard?.note ||
          'AI 正在处理当前阶段，完成后会刷新产物与单集状态。',
        state: 'active' as FlowCardState,
        primaryAction: {
          label: '停止当前任务',
          action: handleStop
        },
        secondaryLabel: undefined,
        secondaryAction: undefined,
        openLabel: nextActionMeta?.openLabel,
        openPath: nextActionMeta?.openPath
      }
    }

    if (!nextWorkflowCard || !nextActionMeta) {
      return {
        label: '等待项目数据',
        status: '未就绪',
        reason: '当前没有可用的阶段操作，请返回项目页检查项目和集数。',
        state: 'blocked' as FlowCardState,
        primaryAction: {
          label: '暂无可用操作',
          disabled: true,
          action: () => {}
        }
      }
    }

    if (workflowAction) {
      return {
        label: nextWorkflowCard.label,
        status: '执行中',
        reason:
          '正在执行当前阶段，完成后会更新产物和审核状态。请等待任务结束。',
        state: 'active' as FlowCardState,
        primaryAction: {
          label: '正在执行，请稍候',
          disabled: true,
          action: () => {}
        }
      }
    }

    const unavailableReason = isRunning
      ? '其他集或项目的流水线正在执行，请等待该任务结束后再启动制作。'
      : displayState === 'error'
        ? '上次执行失败。可展开执行日志查看具体原因，修正后重试。'
        : displayState === 'paused'
          ? '流水线已暂停。可检查现有产物，再通过可用阶段操作继续制作。'
          : ''

    return {
      label: nextWorkflowCard.label,
      status: isRunning
        ? '等待其他任务结束'
        : FLOW_STATE_LABELS[nextWorkflowCard.state],
      reason: [unavailableReason, nextWorkflowCard.note]
        .filter(Boolean)
        .join(' '),
      state: isRunning ? ('blocked' as FlowCardState) : nextWorkflowCard.state,
      primaryAction: {
        label: nextActionMeta.primaryLabel,
        disabled: isRunning || nextActionMeta.primaryDisabled,
        action: nextActionMeta.primaryAction
      },
      secondaryLabel: nextActionMeta.secondaryLabel,
      secondaryDisabled: isRunning || nextActionMeta.secondaryDisabled,
      secondaryAction: nextActionMeta.secondaryAction,
      openLabel: nextActionMeta.openLabel,
      openPath: nextActionMeta.openPath
    }
  }, [
    displayIsRunning,
    displayState,
    isRunning,
    workflowAction,
    workflowCards,
    nextWorkflowCard,
    nextActionMeta,
    handleStop
  ])

  return useMemo(
    () => ({
      currentProject,
      episodeNav: {
        episodes,
        currentEp: episodeNum,
        runningEp: runningEpisodeNum,
        onSelect: handleSelectEpisode
      },
      completionBanner: {
        visible: shouldShowCompletionBanner,
        episodeNum,
        totalElapsed,
        isEngineMatch,
        hasNextEpisode: episodeNum < maxEpisodes,
        onNextEpisode: handleNextEpisode
      },
      summaryCards: {
        entryLabel: summary.entryLabel,
        workflowMode: summary.workflowMode || '未设置',
        currentStageLabel: summary.currentStageLabel || '待开始',
        progress: summary.progress,
        automationReady: summary.automationReady,
        automationGate: summary.automationGate
      },
      commandCenter: {
        episodeNum,
        entryStage,
        entryLabel: summary.entryLabel,
        workflowMode: summary.workflowMode || '未设置',
        currentStageLabel:
          displayIsRunning || workflowAction
            ? nextStep.label
            : summary.currentStageLabel || '待开始',
        displayState,
        displayIsRunning,
        isRunning: isRunning || workflowAction !== null,
        currentEpisode,
        nextStep,
        storyPipelineSteps,
        onStop: handleStop,
        onRetry: handleRetry,
        onOpen: openWorkflowPath
      },
      workflowBoard: {
        cards: workflowCards,
        actionMetaMap: workflowCardActionMetaMap,
        onOpen: openWorkflowPath
      },
      controlBar: {
        episodeNum,
        displayState,
        displayStartedAt,
        totalElapsed,
        displayTimings,
        displayCurrentStage,
        stageElapsed,
        displayIsRunning,
        isRunning,
        stageAvailability,
        onStart: triggerStart,
        onStop: handleStop,
        onSkipReview: handleSkipReview,
        onRetry: handleRetry
      },
      prerequisites: {
        visible: showPrerequisites,
        workflowAvailability,
        stageAvailability,
        toggleLabel: showPrerequisites ? '收起前置' : '展开前置',
        onToggle: togglePrerequisites
      },
      advanced: {
        visible: showAdvanced,
        toggleLabel: showAdvanced ? '收起完整链路' : '展开完整链路',
        onToggle: toggleAdvanced
      },
      workflowActions: {
        currentEpisode,
        workflowAvailability,
        workflowAction,
        workflowReport,
        displayIsRunning,
        onAction: triggerWorkflowAction
      },
      canvas: {
        nodes,
        edges
      },
      logs: {
        visible: showLogs,
        isEngineMatch,
        toggleLabel: showLogs ? '收起日志' : '展开日志',
        onToggle: toggleLogs
      }
    }),
    [
      currentProject,
      entryStage,
      episodes,
      episodeNum,
      totalElapsed,
      runningEpisodeNum,
      shouldShowCompletionBanner,
      maxEpisodes,
      showPrerequisites,
      showLogs,
      showAdvanced,
      currentEpisode,
      workflowAction,
      workflowReport,
      nextStep,
      storyPipelineSteps,
      summary,
      workflowCards,
      workflowCardActionMetaMap,
      stageAvailability,
      workflowAvailability,
      nodes,
      edges,
      displayState,
      displayIsRunning,
      displayStartedAt,
      displayTimings,
      displayCurrentStage,
      stageElapsed,
      isRunning,
      isEngineMatch,
      handleSelectEpisode,
      handleNextEpisode,
      openWorkflowPath,
      triggerStart,
      triggerWorkflowAction,
      handleStop,
      handleSkipReview,
      handleRetry,
      togglePrerequisites,
      toggleLogs,
      toggleAdvanced
    ]
  )
}
