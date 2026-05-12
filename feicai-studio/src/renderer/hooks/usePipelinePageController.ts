import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { normalizeProjectConfig } from '@shared/project-config'
import { AUTO_STAGES } from '@renderer/utils/pipeline-view'
import {
  resolvePipelineDisplayState,
  resolvePipelineSummary
} from '@renderer/utils/pipeline-page-view'
import type { AutomatedPipelineStage } from '@shared/types'
import type {
  FlowCardState,
  WorkflowCard,
  WorkflowCardActionMeta,
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

const NEXT_STEP_STATE_TEXT: Record<FlowCardState, string> = {
  done: '已完成',
  active: '执行中',
  ready: '可执行',
  blocked: '被阻塞',
  skipped: '已跳过',
  warning: '需补齐'
}

function pickNextWorkflowCard(cards: WorkflowCard[]): WorkflowCard {
  const coreCards = cards.filter((card) =>
    ['novel', 'story', 'story_review', 'script', 'script_review'].includes(
      card.id
    )
  )
  const orderedCards = coreCards.length > 0 ? coreCards : cards
  return (
    orderedCards.find((card) => card.state === 'active') ||
    orderedCards.find((card) => card.state === 'ready') ||
    orderedCards.find((card) => card.state === 'warning') ||
    orderedCards.find((card) => card.state === 'blocked') ||
    orderedCards.find((card) => card.state !== 'skipped') ||
    cards[cards.length - 1]
  )
}

function getActionOrNoop(meta: WorkflowCardActionMeta | undefined): () => void {
  return meta?.primaryAction || (() => {})
}

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
  const isNovelEntry = projectConfig.entryStage === 'novel'

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
    hasSourceNovel,
    workflowCards,
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

  const storyPipelineSteps = useMemo(() => {
    const cardMap = Object.fromEntries(
      workflowCards.map((card) => [card.id, card])
    ) as Partial<Record<WorkflowCard['id'], WorkflowCard>>
    const novelMeta = workflowCardActionMetaMap.novel
    const storyMeta = workflowCardActionMetaMap.story
    const storyReviewMeta = workflowCardActionMetaMap.story_review
    const scriptMeta = workflowCardActionMetaMap.script
    const scriptReviewMeta = workflowCardActionMetaMap.script_review

    const openStoryPath = storyMeta?.openPath || storyReviewMeta?.openPath
    const openScriptPath = scriptMeta?.openPath || scriptReviewMeta?.openPath

    return [
      {
        id: 'novel' as const,
        label: '小说原文',
        description: hasSourceNovel
          ? '原文已就绪，可以继续拆解下一批剧情库存。'
          : '先导入或整理小说原文，后续剧情和剧本都从这里开始。',
        state: cardMap.novel?.state || ('blocked' as FlowCardState),
        stateLabel: hasSourceNovel ? '已就绪' : '待导入',
        primaryLabel: hasSourceNovel ? '查看原文' : '录入原文',
        primaryDisabled: !novelMeta?.openPath,
        primaryAction: novelMeta?.openPath
          ? () => openWorkflowPath(novelMeta.openPath!)
          : getActionOrNoop(novelMeta),
        secondaryLabel: workflowAvailability.story.canStart
          ? isNovelEntry
            ? '拆解一批'
            : '生成剧情'
          : undefined,
        secondaryAction: workflowAvailability.story.canStart
          ? storyMeta?.primaryAction
          : undefined
      },
      {
        id: 'story' as const,
        label: isNovelEntry ? '剧情库存批次' : '剧情拆解',
        description: currentEpisode?.hasStoryBeat
          ? isNovelEntry
            ? '当前批次已有剧情拆解草稿，审核通过后才会写入剧情库存。'
            : '当前集已有剧情拆解，审核通过后再生成剧本。'
          : isNovelEntry
            ? '按旧版规则读取 6 章，拆成可供后续剧本消耗的剧情库存。'
            : '把小说内容拆成当前集剧情节奏、关键转折和可拍内容。',
        state: cardMap.story?.state || ('blocked' as FlowCardState),
        stateLabel: currentEpisode?.hasStoryBeat ? '已生成' : '待生成',
        primaryLabel: currentEpisode?.hasStoryBeat
          ? storyReviewMeta?.primaryLabel ||
            (isNovelEntry ? '审核批次' : '审核剧情')
          : storyMeta?.primaryLabel ||
            (isNovelEntry ? '拆解一批' : '生成剧情'),
        primaryDisabled: currentEpisode?.hasStoryBeat
          ? storyReviewMeta?.primaryDisabled
          : storyMeta?.primaryDisabled,
        primaryAction: currentEpisode?.hasStoryBeat
          ? getActionOrNoop(storyReviewMeta)
          : getActionOrNoop(storyMeta),
        secondaryLabel: openStoryPath
          ? isNovelEntry
            ? '查看批次草稿'
            : '查看剧情'
          : undefined,
        secondaryAction: openStoryPath
          ? () => openWorkflowPath(openStoryPath)
          : undefined,
        reviewLabel: currentEpisode?.hasStoryReview
          ? '剧情审核已通过'
          : currentEpisode?.hasStoryBeat
            ? isNovelEntry
              ? '等待批次审核'
              : '等待剧情审核'
            : undefined
      },
      {
        id: 'script' as const,
        label: '剧本',
        description: currentEpisode?.hasScript
          ? '当前集已有剧本，审核通过后即可进入后续制作。'
          : '基于已通过的剧情拆解生成可进入制作段的完整剧本。',
        state: cardMap.script?.state || ('blocked' as FlowCardState),
        stateLabel: currentEpisode?.hasScript ? '已生成' : '待生成',
        primaryLabel: currentEpisode?.hasScript
          ? scriptReviewMeta?.primaryLabel || '审核剧本'
          : scriptMeta?.primaryLabel || '生成剧本',
        primaryDisabled: currentEpisode?.hasScript
          ? scriptReviewMeta?.primaryDisabled
          : scriptMeta?.primaryDisabled,
        primaryAction: currentEpisode?.hasScript
          ? getActionOrNoop(scriptReviewMeta)
          : getActionOrNoop(scriptMeta),
        secondaryLabel: openScriptPath ? '查看剧本' : undefined,
        secondaryAction: openScriptPath
          ? () => openWorkflowPath(openScriptPath)
          : undefined,
        reviewLabel: currentEpisode?.hasScriptReview
          ? '剧本审核已通过'
          : currentEpisode?.hasScript
            ? '等待剧本审核'
            : undefined
      }
    ]
  }, [
    workflowCards,
    workflowCardActionMetaMap,
    hasSourceNovel,
    workflowAvailability,
    currentEpisode,
    openWorkflowPath
  ])

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
        reason: '项目状态仍在同步，请稍后再试。',
        state: 'blocked' as FlowCardState,
        primaryAction: {
          label: '等待同步',
          disabled: true,
          action: () => {}
        }
      }
    }

    return {
      label: nextWorkflowCard.label,
      status: NEXT_STEP_STATE_TEXT[nextWorkflowCard.state],
      reason: nextWorkflowCard.note,
      state: nextWorkflowCard.state,
      primaryAction: {
        label: nextActionMeta.primaryLabel,
        disabled: nextActionMeta.primaryDisabled,
        action: nextActionMeta.primaryAction
      },
      secondaryLabel: nextActionMeta.secondaryLabel,
      secondaryAction: nextActionMeta.secondaryAction,
      openLabel: nextActionMeta.openLabel,
      openPath: nextActionMeta.openPath
    }
  }, [
    displayIsRunning,
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
        entryLabel: summary.entryLabel,
        workflowMode: summary.workflowMode || '未设置',
        currentStageLabel: summary.currentStageLabel || '待开始',
        progress: summary.progress,
        displayState,
        displayIsRunning,
        isRunning,
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
