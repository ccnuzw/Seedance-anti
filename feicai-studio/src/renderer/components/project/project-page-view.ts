import { countCompletedEpisodes } from '@shared/episode-status'
import { normalizeProjectConfig } from '@shared/project-config'
import { getEpisodeProgress, getEpisodeStageMeta } from '@shared/workflow'
import type { Episode, ProjectConfig } from '@shared/types'

export const PROJECT_STATUS_MAP: Record<
  string,
  { label: string; emoji: string; cls: string }
> = {
  idle: { label: '等待', emoji: '⏳', cls: 'badge-info' },
  novel: { label: '已导入小说', emoji: '📚', cls: 'badge-info' },
  story: { label: '已拆剧情', emoji: '🧩', cls: 'badge-info' },
  story_review: { label: '剧情已通过', emoji: '🔎', cls: 'badge-success' },
  script: { label: '已生成剧本', emoji: '📖', cls: 'badge-warning' },
  script_review: { label: '剧本审核中', emoji: '📝', cls: 'badge-warning' },
  script_approved: { label: '剧本已通过', emoji: '✅', cls: 'badge-success' },
  director: { label: '已完成导演分析', emoji: '🎬', cls: 'badge-warning' },
  character: { label: '已完成角色设计', emoji: '🎭', cls: 'badge-warning' },
  art: { label: '已完成服化道', emoji: '🎨', cls: 'badge-warning' },
  storyboard: { label: '已生成分镜', emoji: '📐', cls: 'badge-warning' },
  storyboard_review: {
    label: '已完成分镜审核',
    emoji: '🔍',
    cls: 'badge-warning'
  },
  complete: { label: '已完成', emoji: '✅', cls: 'badge-success' }
}

export function getProjectEntryLabel(
  config: Partial<ProjectConfig> | undefined
): string {
  const normalized = normalizeProjectConfig(config)
  return normalized.entryStage === 'novel'
    ? '从小说开始'
    : normalized.entryStage === 'story'
      ? '从剧情开始'
      : '从剧本开始'
}

export function getProjectProgress(episodes: Episode[]) {
  const completedCount = countCompletedEpisodes(episodes)
  const progressPct =
    episodes.length > 0
      ? Math.round((completedCount / episodes.length) * 100)
      : 0
  return { completedCount, progressPct }
}

export function getEpisodeCardSummary(episode: Episode) {
  const stageMeta = getEpisodeStageMeta(episode.status)
  return {
    stageLabel: stageMeta.shortLabel,
    progress: getEpisodeProgress(episode.status),
    promptCountLabel:
      episode.totalPrompts != null ? `${episode.totalPrompts} 条提示词` : '—',
    durationLabel: episode.totalDurationSeconds
      ? `${episode.totalDurationSeconds}s`
      : '—'
  }
}
