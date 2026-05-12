import { getEpisodeStageMeta } from '@shared/workflow'
import {
  WORKFLOW_STAGE_DEFINITIONS,
  WORKFLOW_STAGE_ORDER
} from '@shared/workflow-definition'
import type {
  Episode,
  EpisodeStatus,
  ProjectConfig,
  ProjectPipelineState,
  WorkflowStageId
} from '@shared/types'
import type {
  ProjectIntegrityReport,
  ProjectReadyItem
} from '@shared/project-detection'
import { getProjectEntryLabel, getProjectProgress } from './project-page-view'

export interface StageCoverageItem {
  key: string
  label: string
  count: number
}

export interface RecentEpisodeItem {
  episodeNumber: number
  title: string
  status: EpisodeStatus
  stageLabel: string
}

export interface ProjectStageTimelineItem {
  id: WorkflowStageId
  label: string
  shortLabel: string
  hint: string
  progress: number
  completedEpisodes: number
  coveragePct: number
  state: 'done' | 'active' | 'upcoming'
}

export interface StageEpisodeItem {
  episodeNumber: number
  title: string
  status: EpisodeStatus
  stageLabel: string
}

export interface StageDrilldownSummary {
  stageId: WorkflowStageId
  stageLabel: string
  reached: StageEpisodeItem[]
  blocked: StageEpisodeItem[]
  pending: StageEpisodeItem[]
}

export interface ProjectRiskItem {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  actionLabel?: string
  actionPath?: string
}

function getEpisodeReachedStageId(episode: Episode): WorkflowStageId {
  return episode.status === 'idle'
    ? 'novel'
    : getEpisodeStageMeta(episode.status).id
}

function buildStageEpisodeItem(episode: Episode): StageEpisodeItem {
  return {
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    status: episode.status,
    stageLabel: getEpisodeStageMeta(episode.status).shortLabel
  }
}

export interface ProjectHealthScore {
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  label: string
  breakdown: Array<{ label: string; score: number }>
}

export interface ProjectExperienceSummary {
  entryLabel: string
  completedCount: number
  progressPct: number
  inProgressCount: number
  idleCount: number
  latestActiveEpisode: number | null
  latestPipelineStatus: string
  pipelineUpdatedAt: string | null
  stageCoverage: StageCoverageItem[]
  stageTimeline: ProjectStageTimelineItem[]
  currentFocusStageLabel: string
  healthScore: ProjectHealthScore
  risks: ProjectRiskItem[]
  recentEpisodes: RecentEpisodeItem[]
}

function countEpisodesReachedStage(
  episodes: Episode[],
  stageId: WorkflowStageId
): number {
  if (stageId === 'novel') {
    return episodes.filter((ep) => ep.status !== 'idle').length
  }
  if (stageId === 'story') {
    return episodes.filter((ep) => ep.hasStoryBeat || ep.status !== 'idle')
      .length
  }
  if (stageId === 'script') {
    return episodes.filter((ep) => ep.hasScript).length
  }
  if (stageId === 'story_review') {
    return episodes.filter((ep) => ep.hasStoryReview).length
  }
  if (stageId === 'script_review') {
    return episodes.filter((ep) => ep.hasScriptReview).length
  }
  if (stageId === 'script_approved') {
    return episodes.filter(
      (ep) =>
        ep.status !== 'idle' && getEpisodeStageMeta(ep.status).progress >= 50
    ).length
  }
  if (stageId === 'director') {
    return episodes.filter((ep) => ep.hasDirectorAnalysis).length
  }
  if (stageId === 'character') {
    return episodes.filter((ep) => ep.hasCharacterDesign).length
  }
  if (stageId === 'art') {
    return episodes.filter((ep) => ep.hasArtDesign).length
  }
  if (stageId === 'storyboard') {
    return episodes.filter((ep) => ep.hasStoryboard).length
  }
  if (stageId === 'storyboard_review') {
    return episodes.filter((ep) => ep.hasStoryboardReview).length
  }
  return episodes.filter((ep) => ep.status === 'complete').length
}

function resolveFocusStageId(episodes: Episode[]): WorkflowStageId {
  if (episodes.length === 0) return 'novel'

  const unfinishedEpisodes = episodes.filter(
    (episode) => episode.status !== 'complete'
  )
  if (unfinishedEpisodes.length === 0) return 'complete'

  const deepestReachedIndex = unfinishedEpisodes.reduce((maxIndex, episode) => {
    const stageId =
      episode.status === 'idle'
        ? 'novel'
        : getEpisodeStageMeta(episode.status).id
    const currentIndex = WORKFLOW_STAGE_ORDER.indexOf(stageId)
    return Math.max(maxIndex, currentIndex)
  }, 0)

  const focusIndex = Math.min(
    deepestReachedIndex + 1,
    WORKFLOW_STAGE_ORDER.length - 1
  )
  return WORKFLOW_STAGE_ORDER[focusIndex]
}

export function buildProjectExperienceSummary(params: {
  episodes: Episode[]
  config?: Partial<ProjectConfig> | null
  projectPipelineState?: ProjectPipelineState | null
  integrityReport?: ProjectIntegrityReport | null
  readyItems?: ProjectReadyItem[]
  projectId?: string
}): ProjectExperienceSummary {
  const {
    episodes,
    config,
    projectPipelineState,
    integrityReport,
    readyItems = [],
    projectId
  } = params
  const { completedCount, progressPct } = getProjectProgress(episodes)
  const inProgressEpisodes = episodes.filter(
    (ep) => ep.status !== 'idle' && ep.status !== 'complete'
  )
  const idleCount = episodes.filter((ep) => ep.status === 'idle').length
  const latestSnapshot = projectPipelineState
    ? Object.values(projectPipelineState.episodes).sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      )[0] || null
    : null
  const latestActiveEpisode = latestSnapshot?.episodeNum || null
  const totalEpisodes = Math.max(episodes.length, 1)
  const stageTimeline = WORKFLOW_STAGE_DEFINITIONS.map((stage) => {
    const completedEpisodes = countEpisodesReachedStage(episodes, stage.id)
    const coveragePct = Math.round((completedEpisodes / totalEpisodes) * 100)
    return {
      id: stage.id,
      label: stage.label,
      shortLabel: stage.shortLabel,
      hint: stage.hint,
      progress: stage.progress,
      completedEpisodes,
      coveragePct,
      state: 'upcoming' as const
    }
  })

  const focusStageId = resolveFocusStageId(episodes)
  const activeTimelineIndex = stageTimeline.findIndex(
    (item) => item.id === focusStageId
  )
  const currentFocusStageLabel =
    activeTimelineIndex >= 0
      ? stageTimeline[activeTimelineIndex].label
      : '全流程完成'
  const resolvedStageTimeline = stageTimeline.map((item, index) => ({
    ...item,
    state:
      activeTimelineIndex === -1
        ? 'done'
        : index < activeTimelineIndex
          ? 'done'
          : index === activeTimelineIndex
            ? 'active'
            : 'upcoming'
  }))

  const stageCoverage: StageCoverageItem[] = [
    {
      key: 'story',
      label: '已拆剧情',
      count: episodes.filter((ep) => ep.hasStoryBeat).length
    },
    {
      key: 'script',
      label: '已生成剧本',
      count: episodes.filter((ep) => ep.hasScript).length
    },
    {
      key: 'script_review',
      label: '已完成剧本审核',
      count: episodes.filter((ep) => ep.hasScriptReview).length
    },
    {
      key: 'director',
      label: '已完成导演分析',
      count: episodes.filter((ep) => ep.hasDirectorAnalysis).length
    },
    {
      key: 'character',
      label: '已完成角色设计',
      count: episodes.filter((ep) => ep.hasCharacterDesign).length
    },
    {
      key: 'art',
      label: '已完成服化道',
      count: episodes.filter((ep) => ep.hasArtDesign).length
    },
    {
      key: 'storyboard',
      label: '已完成分镜',
      count: episodes.filter((ep) => ep.hasStoryboard).length
    },
    {
      key: 'prompts',
      label: '已生成提示词',
      count: episodes.filter((ep) => ep.hasSeedancePrompts).length
    }
  ]

  const recentEpisodes = [...episodes]
    .sort((a, b) => {
      const updatedDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      if (updatedDiff !== 0) return updatedDiff
      return b.episodeNumber - a.episodeNumber
    })
    .slice(0, 5)
    .map((ep) => ({
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      status: ep.status,
      stageLabel: getEpisodeStageMeta(ep.status).shortLabel
    }))

  const risks: ProjectRiskItem[] = []
  const totalEpisodeTarget = Math.max(
    episodes.length,
    config?.totalEpisodes || 0,
    integrityReport?.expectedEpisodes || 0
  )

  if (integrityReport?.status === 'fail') {
    risks.push({
      id: 'integrity-fail',
      severity: 'high',
      title: '项目体检存在关键失败项',
      detail: integrityReport.summary,
      actionLabel: '查看体检报告'
    })
  }

  const missingReadyItems = readyItems.filter((item) => !item.exists)
  if (missingReadyItems.length > 0) {
    risks.push({
      id: 'missing-ready-items',
      severity: missingReadyItems.length >= 3 ? 'high' : 'medium',
      title: `关键文件仍有 ${missingReadyItems.length} 项未就绪`,
      detail: missingReadyItems.map((item) => item.label).join('、'),
      actionLabel: '查看就绪情况'
    })
  }

  if (totalEpisodeTarget > episodes.length) {
    risks.push({
      id: 'episode-coverage-gap',
      severity: totalEpisodeTarget - episodes.length >= 3 ? 'high' : 'medium',
      title: '项目集数覆盖不足',
      detail: `目标 ${totalEpisodeTarget} 集，当前只识别到 ${episodes.length} 集`,
      actionLabel: projectId ? '进入项目页' : undefined,
      actionPath: projectId ? `/project/${projectId}` : undefined
    })
  }

  const reviewFailures = Object.values(
    projectPipelineState?.episodes || {}
  ).flatMap((ep) =>
    (ep.reviews || [])
      .filter((review) => review.result === 'FAIL')
      .map((review) => ({
        episodeNum: ep.episodeNum,
        stage: review.stage,
        createdAt: review.createdAt
      }))
  )
  const latestReviewFailure = reviewFailures.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  )[0]
  if (latestReviewFailure) {
    risks.push({
      id: 'review-failure',
      severity: 'high',
      title: `EP${String(latestReviewFailure.episodeNum).padStart(2, '0')} 存在审核未通过`,
      detail: `最近失败阶段：${latestReviewFailure.stage}`,
      actionLabel: projectId ? '查看该集' : undefined,
      actionPath: projectId
        ? `/project/${projectId}/review?ep=${latestReviewFailure.episodeNum}`
        : undefined
    })
  }

  const stalledEpisodes = episodes.filter((ep) => ep.status === 'idle')
  if (stalledEpisodes.length > 0 && progressPct < 100) {
    risks.push({
      id: 'idle-episodes',
      severity: stalledEpisodes.length >= 5 ? 'medium' : 'low',
      title: `仍有 ${stalledEpisodes.length} 集尚未启动`,
      detail: '部分集数还停留在待开始状态，可能影响整体推进节奏。',
      actionLabel: projectId ? '查看项目集数' : undefined,
      actionPath: projectId ? `/project/${projectId}` : undefined
    })
  }

  const sortedRisks = risks.sort((a, b) => {
    const weight = { high: 3, medium: 2, low: 1 }
    return weight[b.severity] - weight[a.severity]
  })

  const readinessRatio =
    readyItems.length > 0
      ? readyItems.filter((item) => item.exists).length / readyItems.length
      : 1
  const integrityScore =
    integrityReport?.status === 'pass'
      ? 100
      : integrityReport?.status === 'warn'
        ? 75
        : integrityReport?.status === 'fail'
          ? 40
          : 85
  const coverageScore =
    totalEpisodeTarget > 0
      ? Math.round((episodes.length / totalEpisodeTarget) * 100)
      : 100
  const riskPenalty = sortedRisks.reduce(
    (sum, risk) =>
      sum +
      (risk.severity === 'high' ? 12 : risk.severity === 'medium' ? 6 : 2),
    0
  )
  const healthScoreValue = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        progressPct * 0.25 +
          readinessRatio * 100 * 0.2 +
          integrityScore * 0.2 +
          coverageScore * 0.2 +
          (100 - riskPenalty) * 0.15
      )
    )
  )
  const healthGrade: ProjectHealthScore['grade'] =
    healthScoreValue >= 90
      ? 'A'
      : healthScoreValue >= 75
        ? 'B'
        : healthScoreValue >= 60
          ? 'C'
          : 'D'
  const healthLabel =
    healthGrade === 'A'
      ? '健康'
      : healthGrade === 'B'
        ? '可推进'
        : healthGrade === 'C'
          ? '需关注'
          : '高风险'

  return {
    entryLabel: getProjectEntryLabel(config || undefined),
    completedCount,
    progressPct,
    inProgressCount: inProgressEpisodes.length,
    idleCount,
    latestActiveEpisode,
    latestPipelineStatus: latestSnapshot
      ? `${latestSnapshot.episodeNum} 集 · ${getEpisodeStageMeta(latestSnapshot.status).label}`
      : '暂无运行记录',
    pipelineUpdatedAt: projectPipelineState?.updatedAt || null,
    stageCoverage,
    stageTimeline: resolvedStageTimeline,
    currentFocusStageLabel,
    healthScore: {
      score: healthScoreValue,
      grade: healthGrade,
      label: healthLabel,
      breakdown: [
        { label: '推进度', score: progressPct },
        { label: '就绪度', score: Math.round(readinessRatio * 100) },
        { label: '体检完整性', score: integrityScore },
        { label: '集数覆盖', score: coverageScore }
      ]
    },
    risks: sortedRisks,
    recentEpisodes
  }
}

export function buildStageDrilldownSummary(params: {
  episodes: Episode[]
  stageId: WorkflowStageId
}): StageDrilldownSummary {
  const { episodes, stageId } = params
  const targetIndex = WORKFLOW_STAGE_ORDER.indexOf(stageId)
  const reached: StageEpisodeItem[] = []
  const blocked: StageEpisodeItem[] = []
  const pending: StageEpisodeItem[] = []

  for (const episode of episodes) {
    const reachedStageId = getEpisodeReachedStageId(episode)
    const reachedIndex = WORKFLOW_STAGE_ORDER.indexOf(reachedStageId)
    const item = buildStageEpisodeItem(episode)

    if (reachedIndex > targetIndex) {
      reached.push(item)
      continue
    }

    if (reachedIndex === targetIndex) {
      blocked.push(item)
      continue
    }

    pending.push(item)
  }

  return {
    stageId,
    stageLabel:
      WORKFLOW_STAGE_DEFINITIONS.find((item) => item.id === stageId)?.label ||
      stageId,
    reached: reached.sort((a, b) => a.episodeNumber - b.episodeNumber),
    blocked: blocked.sort((a, b) => a.episodeNumber - b.episodeNumber),
    pending: pending.sort((a, b) => a.episodeNumber - b.episodeNumber)
  }
}
