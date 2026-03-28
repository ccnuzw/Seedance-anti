import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { IPC } from '@shared/ipc-channels'
import type { ArtifactRecord, ReviewResult } from '@shared/types'
import { useProjectSync } from '@renderer/hooks/useProjectSync'
import { platformAPI } from '@renderer/platform/api'
import { useAdaptStore } from '@renderer/stores/adaptStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useToastStore } from '@renderer/stores/toastStore'
import { buildProjectRoute } from '@renderer/project-routing'
import {
  buildReviewKey,
  STAGE_PRIORITY
} from '@renderer/components/review-workspace/reviewWorkspaceView'

export type ReviewPageVariant = 'full' | 'writing_panel'

export interface EpisodeState {
  reviews: ReviewResult[]
  completedStages: string[]
  status: string
  updatedAt: string
}

export interface ProjectState {
  episodes: Record<number, EpisodeState>
}

export interface ReviewEntry {
  id: string
  episodeNum: number | null
  review: ReviewResult
  source: 'history' | 'session'
}

export interface EpisodeQualityRow {
  episodeNum: number
  hasScript: boolean
  status: string
  completedStages: string[]
  updatedAt?: string
  reviewCount: number
  issueCount: number
  criticalCount: number
  failCount: number
  artifactCount: number
  lastReview: ReviewResult | null
}

interface ReviewWorkspaceOptions {
  variant?: ReviewPageVariant
  focusEpisode?: number | 'all'
}

export function useReviewWorkspace({
  variant = 'full',
  focusEpisode
}: ReviewWorkspaceOptions) {
  useProjectSync()

  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryEp = Number.parseInt(searchParams.get('ep') || '0', 10)
  const isCompact = variant === 'writing_panel'
  const isWritingQa = location.pathname.includes('/writing/qa')
    || (location.pathname.includes('/script') && searchParams.get('tab') === 'issues')

  const { context } = usePipelineStore()
  const { currentProject, episodes, syncEpisodeStatus } = useProjectStore()
  const { reviewFailedData, adaptState, isRunning, fetchStatus } = useAdaptStore()
  const { addToast } = useToastStore()

  const [selectedEp, setSelectedEp] = useState<number | 'all'>(
    isCompact ? (focusEpisode ?? 'all') : (queryEp > 0 ? queryEp : 'all')
  )
  const [expandedReview, setExpandedReview] = useState<string | null>(null)
  const [historicalState, setHistoricalState] = useState<ProjectState | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [rollingBackArtifactId, setRollingBackArtifactId] = useState<string | null>(null)

  const historicalLoadTokenRef = useRef(0)
  const artifactLoadTokenRef = useRef(0)
  const historicalStateRef = useRef<ProjectState | null>(null)

  const epList = useMemo(
    () => episodes.map((episode) => episode.episodeNumber).sort((a, b) => a - b),
    [episodes]
  )

  useEffect(() => {
    historicalLoadTokenRef.current += 1
    artifactLoadTokenRef.current += 1
    setExpandedReview(null)
    setHistoricalState(null)
    setArtifacts([])
    setLoading(false)
    setArtifactLoading(false)
    setSelectedEp(isCompact ? (focusEpisode ?? 'all') : (queryEp > 0 ? queryEp : 'all'))
  }, [currentProject?.id, focusEpisode, isCompact, queryEp])

  useEffect(() => {
    historicalStateRef.current = historicalState
  }, [historicalState])

  useEffect(() => {
    if (!currentProject) return
    void syncEpisodeStatus()
    if (currentProject.sourceType === 'novel') {
      void fetchStatus(currentProject.projectPath)
    }
  }, [currentProject?.id, currentProject?.projectPath, currentProject?.sourceType, fetchStatus, syncEpisodeStatus])

  useEffect(() => {
    if (isCompact) return
    if (selectedEp === 'all') return
    if (epList.length === 0) {
      setSelectedEp('all')
      return
    }
    if (!epList.includes(selectedEp)) {
      setSelectedEp(epList[0])
    }
  }, [epList, isCompact, selectedEp])

  useEffect(() => {
    if (isCompact) return
    const nextParams = new URLSearchParams(searchParams)
    if (selectedEp === 'all') {
      nextParams.delete('ep')
    } else {
      nextParams.set('ep', String(selectedEp))
    }
    if (nextParams.toString() === searchParams.toString()) return
    setSearchParams(nextParams, { replace: true })
  }, [isCompact, searchParams, selectedEp, setSearchParams])

  useEffect(() => {
    if (!isCompact) return
    setSelectedEp(focusEpisode ?? 'all')
  }, [focusEpisode, isCompact])

  const loadHistoricalState = useCallback(async (showToast = false) => {
    if (!currentProject) return
    const requestToken = ++historicalLoadTokenRef.current
    setLoading(true)
    try {
      const state = await platformAPI.invoke(
        IPC.PROJECT_GET_PIPELINE_STATE,
        currentProject.projectPath
      ) as ProjectState | null
      if (historicalLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== currentProject.id) {
        return
      }
      setHistoricalState(state)
      if (showToast) addToast('success', '审核记录已刷新')
    } catch (error) {
      if (historicalLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === currentProject.id) {
        if (historicalStateRef.current) {
          addToast('warning', `审核记录刷新失败，已保留当前数据：${error instanceof Error ? error.message : String(error)}`)
        } else {
          setHistoricalState(null)
          addToast('error', `加载审核记录失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      if (historicalLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === currentProject.id) {
        setLoading(false)
      }
    }
  }, [addToast, currentProject])

  const loadArtifacts = useCallback(async (showToast = false) => {
    if (!currentProject) return
    const requestToken = ++artifactLoadTokenRef.current
    setArtifactLoading(true)
    try {
      const items = await platformAPI.invoke(
        IPC.ARTIFACT_LIST,
        { projectPath: currentProject.projectPath }
      ) as ArtifactRecord[]
      if (artifactLoadTokenRef.current !== requestToken || useProjectStore.getState().currentProject?.id !== currentProject.id) {
        return
      }
      setArtifacts(items)
      if (showToast) addToast('success', '产物版本已刷新')
    } catch (error) {
      if (artifactLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === currentProject.id) {
        addToast('error', `加载产物版本失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (artifactLoadTokenRef.current === requestToken && useProjectStore.getState().currentProject?.id === currentProject.id) {
        setArtifactLoading(false)
      }
    }
  }, [addToast, currentProject])

  useEffect(() => {
    void loadHistoricalState()
  }, [loadHistoricalState])

  useEffect(() => {
    void loadArtifacts()
  }, [loadArtifacts])

  const handleRollbackArtifact = useCallback(async (artifactId: string) => {
    if (!currentProject || rollingBackArtifactId) return
    setRollingBackArtifactId(artifactId)
    try {
      await platformAPI.invoke(IPC.ARTIFACT_ROLLBACK, {
        projectPath: currentProject.projectPath,
        artifactId
      })
      await Promise.all([
        loadArtifacts(),
        loadHistoricalState(),
        useProjectStore.getState().syncEpisodeStatus()
      ])
      addToast('success', '版本已回滚，并登记为当前产物')
    } catch (error) {
      addToast('error', `版本回滚失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRollingBackArtifactId(null)
    }
  }, [addToast, currentProject, loadArtifacts, loadHistoricalState, rollingBackArtifactId])

  const reviewEntries = useMemo<ReviewEntry[]>(() => {
    const dedup = new Map<string, ReviewEntry>()

    Object.entries(historicalState?.episodes || {}).forEach(([episodeKey, episodeState]) => {
      const episodeNum = Number(episodeKey)
      episodeState.reviews.forEach((review, index) => {
        const entry: ReviewEntry = {
          id: `history-${episodeNum}-${index}-${review.stage}-${review.createdAt}`,
          episodeNum,
          review,
          source: 'history'
        }
        dedup.set(buildReviewKey(episodeNum, review), entry)
      })
    })

    if (currentProject && context?.projectId === currentProject.id && context.episodeNum) {
      context.reviews.forEach((review, index) => {
        const entry: ReviewEntry = {
          id: `session-${context.episodeNum}-${index}-${review.stage}-${review.createdAt}`,
          episodeNum: context.episodeNum,
          review,
          source: 'session'
        }
        dedup.set(buildReviewKey(context.episodeNum, review), entry)
      })
    }

    return [...dedup.values()].sort((a, b) => (
      new Date(b.review.createdAt).getTime() - new Date(a.review.createdAt).getTime()
    ))
  }, [context, currentProject, historicalState])

  const reviewEntriesByEpisode = useMemo(() => {
    const nextMap = new Map<number, ReviewEntry[]>()
    reviewEntries.forEach((entry) => {
      if (!entry.episodeNum) return
      const group = nextMap.get(entry.episodeNum) || []
      group.push(entry)
      nextMap.set(entry.episodeNum, group)
    })
    return nextMap
  }, [reviewEntries])

  const selectedReviewEntries = useMemo(
    () => selectedEp === 'all'
      ? reviewEntries
      : reviewEntries.filter((entry) => entry.episodeNum === selectedEp),
    [reviewEntries, selectedEp]
  )

  const filteredArtifacts = useMemo(
    () => selectedEp === 'all'
      ? artifacts
      : artifacts.filter((artifact) => artifact.episodeNum === selectedEp),
    [artifacts, selectedEp]
  )

  const artifactGroupEntries = useMemo(() => {
    const groups = filteredArtifacts.reduce<Record<string, ArtifactRecord[]>>((acc, artifact) => {
      acc[artifact.scopeKey] = acc[artifact.scopeKey] || []
      acc[artifact.scopeKey].push(artifact)
      acc[artifact.scopeKey].sort((a, b) => b.version - a.version)
      return acc
    }, {})

    return Object.values(groups)
      .sort((a, b) => new Date(b[0].createdAt).getTime() - new Date(a[0].createdAt).getTime())
  }, [filteredArtifacts])

  const visibleArtifactGroups = useMemo(
    () => artifactGroupEntries.slice(0, selectedEp === 'all' ? 10 : 20),
    [artifactGroupEntries, selectedEp]
  )

  const qualityRows = useMemo<EpisodeQualityRow[]>(() => (
    epList.map((episodeNum) => {
      const episode = episodes.find((item) => item.episodeNumber === episodeNum)
      const episodeState = historicalState?.episodes?.[episodeNum]
      const episodeReviews = reviewEntriesByEpisode.get(episodeNum) || []
      const lastReview = episodeReviews[0]?.review || null
      const issueCount = episodeReviews.reduce((sum, entry) => sum + entry.review.issues.length, 0)
      const criticalCount = episodeReviews.reduce(
        (sum, entry) => sum + entry.review.issues.filter((issue) => issue.severity === 'critical').length,
        0
      )
      const failCount = episodeReviews.filter((entry) => !entry.review.passed).length

      return {
        episodeNum,
        hasScript: !!episode?.hasScript,
        status: episode?.status || 'idle',
        completedStages: episodeState?.completedStages || [],
        updatedAt: episodeState?.updatedAt || episode?.updatedAt,
        reviewCount: episodeReviews.length,
        issueCount,
        criticalCount,
        failCount,
        artifactCount: artifacts.filter((artifact) => artifact.episodeNum === episodeNum).length,
        lastReview
      }
    })
  ), [artifacts, epList, episodes, historicalState, reviewEntriesByEpisode])

  const visibleQualityRows = useMemo(
    () => selectedEp === 'all'
      ? qualityRows
      : qualityRows.filter((row) => row.episodeNum === selectedEp),
    [qualityRows, selectedEp]
  )

  const blockerRows = useMemo(() => (
    visibleQualityRows
      .filter((row) => row.failCount > 0 || row.criticalCount > 0 || (!row.hasScript && isWritingQa))
      .sort((a, b) => {
        if (a.hasScript !== b.hasScript) return a.hasScript ? 1 : -1
        if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount
        if (a.failCount !== b.failCount) return b.failCount - a.failCount
        const aStage = STAGE_PRIORITY[a.lastReview?.stage || 'storyboard'] ?? 99
        const bStage = STAGE_PRIORITY[b.lastReview?.stage || 'storyboard'] ?? 99
        return aStage - bStage
      })
  ), [isWritingQa, visibleQualityRows])

  const totalReviews = selectedReviewEntries.length
  const passCount = selectedReviewEntries.filter((entry) => entry.review.passed).length
  const failCount = totalReviews - passCount
  const totalIssues = selectedReviewEntries.reduce((sum, entry) => sum + entry.review.issues.length, 0)
  const criticalCount = selectedReviewEntries.reduce(
    (sum, entry) => sum + entry.review.issues.filter((issue) => issue.severity === 'critical').length,
    0
  )
  const avgScore = totalReviews > 0
    ? Math.round(selectedReviewEntries.reduce((sum, entry) => sum + entry.review.score, 0) / totalReviews * 10) / 10
    : 0

  const scriptReadyCount = qualityRows.filter((row) => row.hasScript).length
  const episodePassCount = qualityRows.filter((row) => row.lastReview?.passed).length
  const focusedRow = selectedEp === 'all'
    ? null
    : qualityRows.find((row) => row.episodeNum === selectedEp) || null
  const recentCompactReviews = selectedReviewEntries.slice(0, selectedEp === 'all' ? 6 : 4)
  const adaptBlockingReview = reviewFailedData?.result as ReviewResult | undefined
  const adaptBlockingHint = reviewFailedData
    ? reviewFailedData.stage === 'script'
      ? '当前阻塞来自分集剧本质检，建议直接回到分集剧本工作区继续修订。'
      : '当前阻塞来自剧情拆解质检，建议回到改编规划补充并修正问题。'
    : ''

  const title = isWritingQa ? '质检修订' : '审核报告与版本'
  const subtitle = reviewFailedData
    ? '当前存在等待人工处理的失败项，先把阻塞问题闭环，再继续推进后续流程。'
    : isRunning
      ? `当前仍有任务运行中，状态：${adaptState}`
      : '把失败项、阶段记录和产物版本收拢到一个页面里处理。'

  const openEpisodeScript = useCallback((episodeNum: number) => {
    if (!currentProject) return
    navigate(buildProjectRoute(currentProject.id, 'script', `ep=${episodeNum}`))
  }, [currentProject, navigate])

  const openEpisodePipeline = useCallback((episodeNum: number) => {
    if (!currentProject) return
    navigate(buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${episodeNum}`))
  }, [currentProject, navigate])

  const openStageWorkspace = useCallback((stage: string, episodeNum?: number | null) => {
    if (!currentProject) return
    if (stage === 'breakdown') {
      navigate(buildProjectRoute(currentProject.id, 'source', 'tab=plan'))
      return
    }
    if (stage === 'script') {
      navigate(buildProjectRoute(currentProject.id, 'script', episodeNum ? `ep=${episodeNum}` : undefined))
      return
    }
    if (episodeNum) {
      navigate(buildProjectRoute(currentProject.id, 'production', `tab=pipeline&ep=${episodeNum}`))
      return
    }
    navigate(buildProjectRoute(currentProject.id, 'production', 'tab=review'))
  }, [currentProject, navigate])

  const handleSelectEpisode = useCallback((episode: number | 'all') => {
    setSelectedEp(episode)
  }, [])

  const handleToggleReview = useCallback((reviewKey: string) => {
    setExpandedReview((current) => current === reviewKey ? null : reviewKey)
  }, [])

  return {
    currentProject,
    isCompact,
    isWritingQa,
    selectedEp,
    expandedReview,
    loading,
    artifactLoading,
    rollingBackArtifactId,
    reviewFailedData,
    adaptState,
    isRunning,
    epList,
    reviewEntries,
    selectedReviewEntries,
    visibleArtifactGroups,
    artifactGroupEntries,
    qualityRows,
    visibleQualityRows,
    blockerRows,
    totalReviews,
    passCount,
    failCount,
    totalIssues,
    criticalCount,
    avgScore,
    scriptReadyCount,
    episodePassCount,
    focusedRow,
    recentCompactReviews,
    adaptBlockingReview,
    adaptBlockingHint,
    title,
    subtitle,
    openEpisodeScript,
    openEpisodePipeline,
    openStageWorkspace,
    handleSelectEpisode,
    handleToggleReview,
    handleRefreshHistoricalState: loadHistoricalState,
    handleRefreshArtifacts: loadArtifacts,
    handleRollbackArtifact,
    handleSetExpandedReview: setExpandedReview
  }
}
