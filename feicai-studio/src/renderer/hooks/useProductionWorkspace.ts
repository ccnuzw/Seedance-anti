import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type {
  LogEntry,
  PipelineRunRecord,
  PipelineState,
  ProjectProgress,
  ProjectProgressEpisode,
  ReviewResult
} from '@shared/types'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'

export type ProductionTab = 'pipeline' | 'assets' | 'prompts' | 'review'

const EMPTY_PIPELINE_LOGS: LogEntry[] = []

function resolveProductionTab(value: string | null): ProductionTab {
  if (value === 'assets' || value === 'prompts' || value === 'review') {
    return value
  }
  return 'pipeline'
}

function formatEpisodeStatus(status?: string): string {
  const map: Record<string, string> = {
    idle: '待制作',
    director: '导演阶段',
    art: '服化道阶段',
    storyboard: '分镜阶段',
    complete: '已完成'
  }
  return map[status || 'idle'] || status || '待制作'
}

function formatPipelineStateLabel(state?: PipelineState): string {
  const map: Partial<Record<PipelineState, string>> = {
    idle: '未开始',
    script_loaded: '待启动',
    director_analyzing: '导演分析中',
    director_reviewing: '导演审核中',
    director_done: '导演已完成',
    art_designing: '服化道生成中',
    art_reviewing: '服化道审核中',
    art_done: '服化道已完成',
    storyboard_writing: '分镜生成中',
    storyboard_reviewing: '分镜审核中',
    episode_complete: '整集已完成',
    paused: '已暂停',
    error: '执行失败'
  }
  return map[state || 'idle'] || state || '未开始'
}

function resolveArtStageLabel(progressEpisode: ProjectProgressEpisode | null, currentState?: PipelineState): string {
  if (!progressEpisode) return '未开始'
  if (progressEpisode.currentPipelineState === 'art_designing' || currentState === 'art_designing') return '生成中'
  if (progressEpisode.currentPipelineState === 'art_reviewing' || currentState === 'art_reviewing') return '审核中'
  if (progressEpisode.stageState === 'failed' && progressEpisode.status === 'art') return '失败'
  if (progressEpisode.hasArtDesign && progressEpisode.hasAssetUpdates) return '已完成并已新增提示词'
  if (progressEpisode.hasArtDesign) return '已完成'
  if (progressEpisode.hasDirectorAnalysis) return '未开始'
  return '待导演完成'
}

function buildArtReviewSummary(review?: ReviewResult | null): string | null {
  if (!review) return null
  if (review.result === 'PASS') {
    return `审核通过 · 评分 ${review.score}`
  }
  const topIssue = review.issues[0]
  if (topIssue?.suggestion) {
    return `审核未通过 · ${topIssue.suggestion}`
  }
  if (topIssue?.description) {
    return `审核未通过 · ${topIssue.description}`
  }
  return review.feedback || '审核未通过，请根据反馈修改后重试。'
}

export function useProductionWorkspace() {
  useProjectSync()

  const [searchParams, setSearchParams] = useSearchParams()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const addToast = useToastStore((state) => state.addToast)
  const [recentRuns, setRecentRuns] = useState<PipelineRunRecord[]>([])
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(searchParams.get('tab') === 'batch')
  const [projectProgress, setProjectProgress] = useState<ProjectProgress | null>(null)
  const [progressLoading, setProgressLoading] = useState(false)
  const [artActionRunning, setArtActionRunning] = useState(false)

  const activeTab = resolveProductionTab(searchParams.get('tab'))
  const context = usePipelineStore((state) => state.context)
  const state = usePipelineStore((state) => state.state)
  const isRunning = usePipelineStore((state) => state.isRunning)
  const currentReview = usePipelineStore((state) => state.currentReview)
  const setupEventListeners = usePipelineStore((state) => state.setupEventListeners)
  const syncFromBackend = usePipelineStore((state) => state.syncFromBackend)
  const startPipeline = usePipelineStore((state) => state.startPipeline)
  const recentPipelineLogs = usePipelineStore((storeState) => (
    activeTab === 'pipeline' ? storeState.logs : EMPTY_PIPELINE_LOGS
  ))
  const requestedEpisode = Number.parseInt(searchParams.get('ep') || '0', 10)
  const fallbackEpisode = context?.projectId === currentProject?.id
    ? context.episodeNum
    : episodes[0]?.episodeNumber || 1
  const currentEpisode = Number.isFinite(requestedEpisode) && requestedEpisode > 0
    ? requestedEpisode
    : fallbackEpisode

  const currentEpisodeRecord = episodes.find((episode) => episode.episodeNumber === currentEpisode) || null
  const scriptReadyCount = episodes.filter((episode) => episode.hasScript).length
  const promptReadyCount = episodes.filter((episode) => episode.hasSeedancePrompts).length
  const inProductionCount = episodes.filter((episode) => episode.status !== 'idle' && episode.status !== 'complete').length
  const completedCount = episodes.filter((episode) => episode.status === 'complete').length
  const runningLogEntries = useMemo(() => recentPipelineLogs.slice(-8).reverse(), [recentPipelineLogs])
  const activeBatchRuns = useMemo(
    () => recentRuns.filter((run) => !!run.batchId).slice(0, 6),
    [recentRuns]
  )
  const shouldPollRecentRuns = activeTab === 'pipeline' || batchDrawerOpen

  const currentProgressEpisode = useMemo(
    () => projectProgress?.episodes.find((episode) => episode.episodeNumber === currentEpisode) || null,
    [currentEpisode, projectProgress]
  )

  const latestArtReview = useMemo(() => {
    const runtimeReview = context?.episodeNum === currentEpisode
      ? (context.reviews || []).filter((review) => review.stage === 'art').slice(-1)[0] || null
      : null
    if (runtimeReview) return runtimeReview
    if (currentReview?.stage === 'art') return currentReview
    return null
  }, [context?.episodeNum, context?.reviews, currentEpisode, currentReview])

  const currentEpisodeStatusLabel = useMemo(() => {
    const base = formatEpisodeStatus(currentEpisodeRecord?.status)
    if (currentProgressEpisode?.statusLabel && currentProgressEpisode.statusLabel !== base) {
      return currentProgressEpisode.statusLabel
    }
    return base
  }, [currentEpisodeRecord?.status, currentProgressEpisode?.statusLabel])

  const artStageLabel = useMemo(
    () => resolveArtStageLabel(currentProgressEpisode, context?.episodeNum === currentEpisode ? state : undefined),
    [currentEpisode, currentProgressEpisode, context?.episodeNum, state]
  )

  const artReviewSummary = useMemo(
    () => buildArtReviewSummary(latestArtReview),
    [latestArtReview]
  )

  const canStartArtStage = Boolean(
    currentProject &&
    currentEpisodeRecord?.hasScript &&
    currentEpisodeRecord?.hasDirectorAnalysis &&
    (!isRunning || (context?.projectId === currentProject.id && context?.episodeNum === currentEpisode && state.startsWith('art_')) === true) === false
  )

  const refreshProjectProgress = useCallback(async () => {
    if (!currentProject) {
      setProjectProgress(null)
      return false
    }
    setProgressLoading(true)
    try {
      const progress = await platformAPI.invoke(
        IPC.PROJECT_GET_PROGRESS,
        currentProject.projectPath,
        currentProject.totalEpisodes || episodes.length
      ) as ProjectProgress
      setProjectProgress(progress)
      return true
    } catch {
      setProjectProgress(null)
      return false
    } finally {
      setProgressLoading(false)
    }
  }, [currentProject, episodes.length])

  useEffect(() => {
    if (!currentProject) return
    void syncEpisodeStatus()
  }, [currentProject?.id, syncEpisodeStatus])

  useEffect(() => {
    const cleanup = setupEventListeners()
    return cleanup
  }, [setupEventListeners])

  useEffect(() => {
    void syncFromBackend()
  }, [currentProject?.id, syncFromBackend])

  useEffect(() => {
    if (!currentProject) {
      setProjectProgress(null)
      return
    }
    void refreshProjectProgress()
  }, [currentProject?.id, refreshProjectProgress])

  useEffect(() => {
    if (searchParams.get('tab') !== 'batch') return
    setBatchDrawerOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!currentProject) {
      setRecentRuns([])
      return
    }
    if (!shouldPollRecentRuns) return

    let cancelled = false
    const loadRuns = async () => {
      try {
        const runs = await platformAPI.invoke(
          IPC.PIPELINE_LIST_RUNS,
          currentProject.id,
          18,
          true
        ) as PipelineRunRecord[]
        if (!cancelled) {
          setRecentRuns(runs)
        }
      } catch {
        if (!cancelled) {
          setRecentRuns([])
        }
      }
    }

    void loadRuns()
    const timer = window.setInterval(() => {
      void loadRuns()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [currentProject?.id, shouldPollRecentRuns])

  useEffect(() => {
    if (episodes.length === 0) return
    if (requestedEpisode > 0 && episodes.some((episode) => episode.episodeNumber === requestedEpisode)) return
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(fallbackEpisode))
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  }, [episodes, fallbackEpisode, requestedEpisode, searchParams, setSearchParams])

  const handleChangeTab = useCallback((tab: ProductionTab) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'pipeline') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const handleEpisodeChange = useCallback((episode: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('ep', String(episode))
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const handleOpenBatchDrawer = useCallback(() => {
    setBatchDrawerOpen(true)
  }, [])

  const handleCloseBatchDrawer = useCallback(() => {
    setBatchDrawerOpen(false)
  }, [])

  const handleStartArtDesign = useCallback(async () => {
    if (!currentProject || !currentEpisodeRecord) return
    if (!currentEpisodeRecord.hasScript) {
      addToast('warning', `EP${String(currentEpisode).padStart(3, '0')} 缺少剧本，暂时无法启动服化道`, { title: '~design' })
      return
    }
    if (!currentEpisodeRecord.hasDirectorAnalysis) {
      addToast('warning', `EP${String(currentEpisode).padStart(3, '0')} 需先完成导演分析，再启动服化道`, { title: '~design' })
      return
    }
    if (isRunning) {
      addToast('warning', '当前已有制作任务运行中，请先等待完成或处理当前任务', { title: '~design' })
      return
    }

    setArtActionRunning(true)
    try {
      const result = await startPipeline({
        projectId: currentProject.id,
        projectPath: currentProject.projectPath,
        episodeNum: currentEpisode,
        projectName: currentProject.name,
        visualStyle: currentProject.visualStyle,
        targetMedium: currentProject.targetMedium,
        startStage: 'art',
        singleStage: true
      })
      if (result.error) {
        addToast('error', result.error, { title: '~design' })
        return
      }
      addToast('info', `EP${String(currentEpisode).padStart(3, '0')} 已启动服化道设计`, { title: '~design' })
      void Promise.all([syncEpisodeStatus(), refreshProjectProgress()])
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : '启动服化道设计失败', { title: '~design' })
    } finally {
      setArtActionRunning(false)
    }
  }, [addToast, currentEpisode, currentEpisodeRecord, currentProject, isRunning, refreshProjectProgress, startPipeline, syncEpisodeStatus])

  useEffect(() => {
    if (!currentProject) return
    const timer = window.setInterval(() => {
      void refreshProjectProgress()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [currentProject?.id, refreshProjectProgress])

  return {
    currentProject,
    activeTab,
    currentEpisode,
    currentEpisodeRecord,
    currentEpisodeStatusLabel,
    isRunning,
    state,
    context,
    scriptReadyCount,
    promptReadyCount,
    inProductionCount,
    completedCount,
    runningLogEntries,
    activeBatchRuns,
    batchDrawerOpen,
    projectProgress,
    progressLoading,
    currentProgressEpisode,
    currentPipelineStateLabel: formatPipelineStateLabel(context?.episodeNum === currentEpisode ? state : currentProgressEpisode?.currentPipelineState),
    artStageLabel,
    artReviewSummary,
    latestArtReview,
    artActionRunning,
    canStartArtStage,
    handleChangeTab,
    handleEpisodeChange,
    handleOpenBatchDrawer,
    handleCloseBatchDrawer,
    handleStartArtDesign,
    handleRefreshProgress: refreshProjectProgress
  }
}
