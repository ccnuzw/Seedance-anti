import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type {
  LogEntry,
  PipelineLLMCallRecord,
  PipelineRunDetail,
  PipelineRunRecord,
  PipelineStage,
  PipelineState
} from '@shared/types'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { buildProjectRoute } from '@renderer/project-routing'
import {
  fmtTime,
  getTimingElapsed,
  isStageActive,
  isStageDone,
  mapEpisodeStatusToPipelineState,
  resolveSelectedRunLLMCalls,
  resolveSelectedRunLogs,
  STAGES
} from '@renderer/components/pipeline/pipelineWorkspaceView'

interface StageTimingLike {
  stage: PipelineStage
  startedAt: number
  endedAt?: number
  elapsed: number
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      setNow(Date.now())
      return
    }
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [active])

  return now
}

export function usePipelineWorkspace() {
  useProjectSync()

  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const {
    state,
    isRunning,
    context,
    logs,
    setupEventListeners,
    startPipeline,
    pausePipeline,
    resumePipeline,
    stopPipeline,
    retryPipeline,
    skipReviewPipeline,
    stageTimings,
    currentStageName,
    resetDisplay,
    syncFromBackend
  } = usePipelineStore()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const { addToast } = useToastStore()

  const [recentRuns, setRecentRuns] = useState<PipelineRunRecord[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunDetail, setSelectedRunDetail] = useState<PipelineRunDetail | null>(null)
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const selectedRunSourceRef = useRef<'auto' | 'manual'>('auto')
  const prevEpRef = useRef(0)
  const prevProjectIdRef = useRef<string | null>(null)

  const urlEp = searchParams.get('ep')
  const parsedEpisodeNum = Number.parseInt(urlEp || (context?.episodeNum ? String(context.episodeNum) : '1'), 10)
  const episodeNum = Number.isFinite(parsedEpisodeNum) && parsedEpisodeNum > 0 ? parsedEpisodeNum : 1
  const episodeNumbers = episodes.map((episode) => episode.episodeNumber)
  const maxEpisodeNum = episodeNumbers.length > 0
    ? Math.max(...episodeNumbers)
    : Math.max(currentProject?.totalEpisodes || 1, 1)
  const hasEpisodeInProject = episodeNumbers.length === 0 || episodeNumbers.includes(episodeNum)
  const isEpisodeSelectable = episodeNum >= 1 && episodeNum <= maxEpisodeNum && hasEpisodeInProject

  useEffect(() => {
    if (currentProject && episodes.length === 0) {
      void syncEpisodeStatus()
    }
  }, [currentProject?.id, episodes.length, syncEpisodeStatus])

  const refreshRecentRuns = useCallback(async () => {
    if (!currentProject) {
      setRecentRuns([])
      return
    }

    try {
      const runs = await platformAPI.invoke(
        IPC.PIPELINE_LIST_RUNS,
        currentProject.id,
        12
      ) as PipelineRunRecord[]
      setRecentRuns(runs)
    } catch {
      setRecentRuns([])
    }
  }, [currentProject])

  useEffect(() => {
    if (!currentProject) {
      setRecentRuns([])
      setSelectedRunId(null)
      setSelectedRunDetail(null)
      return
    }

    void refreshRecentRuns()
    const timer = window.setInterval(() => {
      void refreshRecentRuns()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [currentProject, refreshRecentRuns])

  useEffect(() => {
    if (recentRuns.length === 0) {
      setSelectedRunId(null)
      setSelectedRunDetail(null)
      selectedRunSourceRef.current = 'auto'
      return
    }

    const selectedRun = selectedRunId
      ? recentRuns.find((run) => run.runId === selectedRunId) || null
      : null
    const currentRunId = context?.projectId === currentProject?.id &&
      context?.runId &&
      recentRuns.some((run) => run.runId === context.runId)
      ? context.runId
      : null

    if (
      currentRunId &&
      currentRunId !== selectedRunId &&
      (
        !selectedRun ||
        selectedRunSourceRef.current === 'auto' ||
        selectedRun.status === 'queued'
      )
    ) {
      selectedRunSourceRef.current = 'auto'
      setSelectedRunId(currentRunId)
      return
    }

    if (selectedRun) return

    selectedRunSourceRef.current = 'auto'
    setSelectedRunId(currentRunId || recentRuns[0].runId)
  }, [context?.projectId, context?.runId, currentProject?.id, recentRuns, selectedRunId])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunDetail(null)
      setRunDetailLoading(false)
      return
    }

    let cancelled = false
    const loadDetail = async (foreground: boolean) => {
      if (foreground) {
        setRunDetailLoading(true)
      }
      try {
        const detail = await platformAPI.invoke(
          IPC.PIPELINE_GET_RUN_DETAIL,
          selectedRunId
        ) as PipelineRunDetail | null
        if (!cancelled) {
          setSelectedRunDetail(detail)
        }
      } catch {
        if (!cancelled) {
          setSelectedRunDetail(null)
        }
      } finally {
        if (!cancelled && foreground) {
          setRunDetailLoading(false)
        }
      }
    }

    void loadDetail(true)
    const timer = window.setInterval(() => {
      void loadDetail(false)
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [selectedRunId])

  const isEngineMatch = context?.episodeNum === episodeNum &&
    context?.projectId === currentProject?.id
  const epStatusFromDB = episodes.find((episode) => episode.episodeNumber === episodeNum)?.status
  const displayState = isEngineMatch ? state : mapEpisodeStatusToPipelineState(epStatusFromDB)
  const displayIsRunning = isEngineMatch ? isRunning : false
  const displayTimings = isEngineMatch ? stageTimings : []
  const displayCurrentStage = isEngineMatch ? currentStageName : null
  const isPaused = isEngineMatch && displayState === 'paused'
  const engineOccupied = isRunning || state === 'paused'
  const timingNow = useNow(displayTimings.some((timing) => !timing.endedAt))
  const totalElapsed = displayTimings.reduce(
    (sum, timing) => sum + getTimingElapsed(timing as StageTimingLike, timingNow),
    0
  )

  const stageElapsedMap = useMemo(() => {
    return STAGES.reduce((acc, stage) => {
      acc[stage.id] = displayTimings
        .filter((timing) => timing.stage === stage.id)
        .reduce((sum, timing) => sum + getTimingElapsed(timing as StageTimingLike, timingNow), 0)
      return acc
    }, {} as Record<PipelineStage, number>)
  }, [displayTimings, timingNow])

  useEffect(() => {
    if (!isEngineMatch) return
    if (state === 'episode_complete' && episodeNum) {
      addToast('success', `EP${String(episodeNum).padStart(3, '0')} 全流程完成！`, { title: '🎉 流水线完成' })
      try {
        new Notification('FEICAI Studio', {
          body: `EP${String(episodeNum).padStart(3, '0')} 全流程完成 ✅`,
          silent: false
        })
      } catch {
        // ignore notification permission failures
      }
    }
    if (state === 'error') {
      addToast('error', '流水线执行遇到错误，请查看日志', { title: '执行出错' })
    }
  }, [addToast, episodeNum, isEngineMatch, state])

  const handleNextEpisode = useCallback(() => {
    const nextEp = episodeNum + 1
    const maxEp = Math.max(currentProject?.totalEpisodes || 1, maxEpisodeNum)
    if (nextEp <= maxEp && currentProject) {
      navigate(buildProjectRoute(currentProject.id, 'production', `ep=${nextEp}`))
    }
  }, [currentProject, episodeNum, maxEpisodeNum, navigate])

  const handleStart = useCallback(async (startStage?: PipelineStage, singleStage?: boolean) => {
    if (!currentProject) return
    if (!isEpisodeSelectable) {
      addToast('error', `EP${String(episodeNum).padStart(3, '0')} 不存在于当前项目中`)
      return
    }
    const stageLabel = startStage
      ? STAGES.find((stage) => stage.id === startStage)?.label || startStage
      : '全流程'
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
      addToast('info', `EP${String(episodeNum).padStart(3, '0')} ${stageLabel}已启动`)
    }
  }, [addToast, currentProject, episodeNum, isEpisodeSelectable, startPipeline])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey

      if (isMeta && event.key === 'Enter' && !engineOccupied && currentProject && isEpisodeSelectable) {
        event.preventDefault()
        void handleStart('director', false)
      }
      if (isMeta && event.key === 'p') {
        event.preventDefault()
        if (displayIsRunning) {
          void (async () => {
            const success = await pausePipeline()
            addToast(success ? 'info' : 'error', success ? '流水线已暂停' : '暂停失败')
          })()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addToast, currentProject, displayIsRunning, engineOccupied, handleStart, isEpisodeSelectable, pausePipeline])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    const projectChanged = prevProjectIdRef.current !== (currentProject?.id ?? null)
    const episodeChanged = prevEpRef.current !== episodeNum
    if (projectChanged || episodeChanged) {
      prevProjectIdRef.current = currentProject?.id ?? null
      prevEpRef.current = episodeNum
      if (!usePipelineStore.getState().isRunning) {
        resetDisplay()
      }
    }
    void syncFromBackend()
  }, [currentProject?.id, episodeNum, resetDisplay, syncFromBackend])

  const nodes: Node[] = useMemo(() => {
    const result: Node[] = []
    const xStart = 80
    const xGap = 200
    const yStage = 100
    const yReview = 220

    result.push({
      id: 'start',
      type: 'stage',
      position: { x: xStart - 160, y: yStage },
      data: {
        label: '剧本',
        emoji: '📖',
        stage: 'start',
        state: displayState,
        isActive: false,
        isDone: displayState !== 'idle'
      }
    })

    STAGES.forEach((stage, index) => {
      const x = xStart + index * xGap
      const stageIsActive = isStageActive(stage.id, displayState)
      const stageIsDone = isStageDone(stage.id, displayState)
      const stageElapsed = stageElapsedMap[stage.id]
      const timeLabel = stageElapsed > 0 ? fmtTime(stageElapsed) : ''

      result.push({
        id: stage.id,
        type: 'stage',
        position: { x, y: yStage },
        data: {
          label: stage.label,
          emoji: stage.emoji,
          stage: stage.id,
          state: displayState,
          isActive: stageIsActive,
          isDone: stageIsDone,
          timeLabel
        }
      })

      const reviewForStage = (isEngineMatch ? context?.reviews : [])?.filter((review) => review.stage === stage.id).pop() || null
      result.push({
        id: `review-${stage.id}`,
        type: 'review',
        position: { x: x + 24, y: yReview },
        data: {
          label: '审核',
          stage: stage.id,
          review: reviewForStage,
          isActive: (displayState as string) === `${stage.id}_reviewing`
        }
      })
    })

    return result
  }, [context, displayState, isEngineMatch, stageElapsedMap])

  const edges: Edge[] = useMemo(() => {
    const result: Edge[] = [
      {
        id: 'e-start-director',
        source: 'start',
        target: 'director',
        animated: displayState === 'script_loaded',
        style: { stroke: 'var(--color-border)' },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border)' }
      }
    ]

    STAGES.forEach((stage, index) => {
      result.push({
        id: `e-${stage.id}-review`,
        source: stage.id,
        target: `review-${stage.id}`,
        animated: isStageActive(stage.id, displayState),
        style: { stroke: 'var(--color-border)' }
      })

      if (index < STAGES.length - 1) {
        result.push({
          id: `e-${stage.id}-${STAGES[index + 1].id}`,
          source: stage.id,
          target: STAGES[index + 1].id,
          animated: isStageDone(stage.id, displayState) && isStageActive(STAGES[index + 1].id, displayState),
          style: { stroke: 'var(--color-border)' },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-border)' }
        })
      }
    })

    return result
  }, [displayState])

  const selectedRun = recentRuns.find((run) => run.runId === selectedRunId) || selectedRunDetail?.run || null
  const selectedRunLogs: LogEntry[] = resolveSelectedRunLogs(selectedRun, selectedRunDetail, context?.runId, logs)
  const selectedRunLLMCalls: PipelineLLMCallRecord[] = resolveSelectedRunLLMCalls(selectedRunDetail)

  const handleSelectEpisode = useCallback((episode: number) => {
    if (!currentProject) return
    navigate(buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${episode}`))
  }, [currentProject, navigate])

  const handleSelectRun = useCallback((runId: string) => {
    selectedRunSourceRef.current = 'manual'
    setSelectedRunId(runId)
  }, [])

  const handlePause = useCallback(async () => {
    const success = await pausePipeline()
    addToast(success ? 'info' : 'error', success ? '流水线已暂停' : '暂停失败')
  }, [addToast, pausePipeline])

  const handleResume = useCallback(async () => {
    const success = await resumePipeline()
    addToast(success ? 'info' : 'error', success ? '流水线正在恢复' : '恢复失败')
  }, [addToast, resumePipeline])

  const handleStop = useCallback(async () => {
    const success = await stopPipeline()
    addToast(success ? 'warning' : 'error', success ? '流水线已停止' : '停止失败')
  }, [addToast, stopPipeline])

  const handleSkipReview = useCallback(async () => {
    const success = await skipReviewPipeline()
    addToast(success ? 'info' : 'error', success ? '已跳过当前阶段审核' : '跳过审核失败')
  }, [addToast, skipReviewPipeline])

  const handleRetry = useCallback(async () => {
    const success = await retryPipeline()
    addToast(success ? 'info' : 'error', success ? '正在重试流水线...' : '重试流水线失败')
  }, [addToast, retryPipeline])

  const handleResumeBackground = useCallback(async () => {
    const success = await resumePipeline()
    addToast(success ? 'info' : 'error', success ? '后台任务正在恢复' : '恢复后台任务失败')
  }, [addToast, resumePipeline])

  const handleStopBackground = useCallback(async () => {
    const success = await stopPipeline()
    addToast(success ? 'warning' : 'error', success ? '后台任务已停止' : '停止后台任务失败')
  }, [addToast, stopPipeline])

  return {
    currentProject,
    episodes,
    context,
    state,
    displayState,
    displayIsRunning,
    displayTimings,
    displayCurrentStage,
    isEngineMatch,
    isPaused,
    engineOccupied,
    episodeNum,
    maxEpisodeNum,
    isEpisodeSelectable,
    totalElapsed,
    stageElapsedMap,
    nodes,
    edges,
    recentRuns,
    selectedRunId,
    selectedRun,
    selectedRunLogs,
    selectedRunLLMCalls,
    runDetailLoading,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    handleSkipReview,
    handleRetry,
    handleNextEpisode,
    handleSelectEpisode,
    handleSelectRun,
    handleResumeBackground,
    handleStopBackground
  }
}
