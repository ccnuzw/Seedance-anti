import type { Episode, EpisodeStatus } from '@shared/types'

export type ProjectProgressTone = 'default' | 'warning' | 'success' | 'danger' | 'info'

export interface ProjectProgressStageMeta {
  key: EpisodeStatus
  label: string
  shortLabel: string
  description: string
  tone: ProjectProgressTone
}

export interface ProjectProgressEpisodeItem {
  episodeNumber: number
  code: string
  title: string
  stage: ProjectProgressStageMeta
  hasScript: boolean
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
  totalPrompts?: number
  totalDurationSeconds?: number
}

export interface ProjectProgressSummaryItem {
  key: EpisodeStatus
  label: string
  count: number
  tone: ProjectProgressTone
}

export interface ProjectProgressSummary {
  totalEpisodes: number
  completedCount: number
  activeCount: number
  pendingCount: number
  completionRate: number
  stageCounts: Record<EpisodeStatus, number>
  stageSummary: ProjectProgressSummaryItem[]
  humanSummary: string
}

const STAGE_META: Record<EpisodeStatus, ProjectProgressStageMeta> = {
  idle: {
    key: 'idle',
    label: '未开始',
    shortLabel: '未开始',
    description: '尚未进入导演分析阶段。',
    tone: 'default'
  },
  director: {
    key: 'director',
    label: '导演分析',
    shortLabel: '导演',
    description: '已形成导演分析，待推进服化道或后续制作。',
    tone: 'info'
  },
  art: {
    key: 'art',
    label: '服化道',
    shortLabel: '服化道',
    description: '已形成服化道结果，待推进分镜 / 提示词。',
    tone: 'warning'
  },
  storyboard: {
    key: 'storyboard',
    label: '分镜',
    shortLabel: '分镜',
    description: '已进入分镜阶段，接近完整制作收口。',
    tone: 'warning'
  },
  complete: {
    key: 'complete',
    label: '已完成',
    shortLabel: '完成',
    description: '该集已完成当前定义下的制作闭环。',
    tone: 'success'
  }
}

function formatEpisodeCode(episodeNumber: number): string {
  return `EP${String(episodeNumber).padStart(3, '0')}`
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—'
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  if (minutes <= 0) return `${remain}秒`
  if (remain === 0) return `${minutes}分`
  return `${minutes}分${remain}秒`
}

export function getProjectProgressStageMeta(status: EpisodeStatus): ProjectProgressStageMeta {
  return STAGE_META[status] || STAGE_META.idle
}

export function buildProjectProgressEpisodes(episodes: Episode[]): ProjectProgressEpisodeItem[] {
  return [...episodes]
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((episode) => ({
      episodeNumber: episode.episodeNumber,
      code: formatEpisodeCode(episode.episodeNumber),
      title: episode.title,
      stage: getProjectProgressStageMeta(episode.status),
      hasScript: episode.hasScript,
      hasDirectorAnalysis: episode.hasDirectorAnalysis,
      hasArtDesign: episode.hasArtDesign,
      hasSeedancePrompts: episode.hasSeedancePrompts,
      totalPrompts: episode.totalPrompts,
      totalDurationSeconds: episode.totalDurationSeconds
    }))
}

export function buildProjectProgressSummary(episodes: Episode[], expectedTotalEpisodes?: number): ProjectProgressSummary {
  const totalEpisodes = Math.max(expectedTotalEpisodes || 0, episodes.length)
  const stageCounts: Record<EpisodeStatus, number> = {
    idle: 0,
    director: 0,
    art: 0,
    storyboard: 0,
    complete: 0
  }

  for (const episode of episodes) {
    stageCounts[episode.status] = (stageCounts[episode.status] || 0) + 1
  }

  if (totalEpisodes > episodes.length) {
    stageCounts.idle += totalEpisodes - episodes.length
  }

  const completedCount = stageCounts.complete
  const activeCount = stageCounts.director + stageCounts.art + stageCounts.storyboard
  const pendingCount = stageCounts.idle
  const completionRate = totalEpisodes > 0 ? Math.round((completedCount / totalEpisodes) * 100) : 0

  const stageSummary: ProjectProgressSummaryItem[] = [
    STAGE_META.idle,
    STAGE_META.director,
    STAGE_META.art,
    STAGE_META.storyboard,
    STAGE_META.complete
  ].map((meta) => ({
    key: meta.key,
    label: meta.label,
    count: stageCounts[meta.key],
    tone: meta.tone
  }))

  let humanSummary = '项目状态待确认'
  if (totalEpisodes <= 0) {
    humanSummary = '当前还没有可展示的集数状态'
  } else if (completedCount === totalEpisodes) {
    humanSummary = `全部 ${totalEpisodes} 集已完成，可进入交付与导出收口。`
  } else if (activeCount > 0) {
    humanSummary = `${activeCount} 集正在制作推进中，${completedCount}/${totalEpisodes} 集已完成。`
  } else if (pendingCount === totalEpisodes) {
    humanSummary = `全部 ${totalEpisodes} 集尚未开始，建议先从内容准备或剧本创作进入。`
  } else {
    humanSummary = `${completedCount}/${totalEpisodes} 集已完成，其余集数仍待继续推进。`
  }

  return {
    totalEpisodes,
    completedCount,
    activeCount,
    pendingCount,
    completionRate,
    stageCounts,
    stageSummary,
    humanSummary
  }
}

export function formatProjectProgressRefreshTime(timestamp?: number | null): string {
  if (!timestamp) return '尚未刷新'
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatProjectProgressPromptMeta(totalPrompts?: number, totalDurationSeconds?: number): string {
  const promptText = typeof totalPrompts === 'number' && totalPrompts > 0 ? `${totalPrompts} 条提示词` : '提示词待生成'
  const durationText = formatDuration(totalDurationSeconds)
  return durationText === '—' ? promptText : `${promptText} · ${durationText}`
}
