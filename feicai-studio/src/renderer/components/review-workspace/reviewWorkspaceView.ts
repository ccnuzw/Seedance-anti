import type { ReviewResult } from '@shared/types'

export const STAGE_LABELS: Record<string, string> = {
  director: '导演分析',
  art: '服化道设计',
  storyboard: '分镜编写',
  breakdown: '剧情拆解',
  script: '分集剧本'
}

export const STAGE_PRIORITY: Record<string, number> = {
  script: 0,
  breakdown: 1,
  storyboard: 2,
  art: 3,
  director: 4
}

export const SEVERITY_MAP: Record<string, { label: string; cls: string }> = {
  critical: { label: '严重', cls: 'severity-critical' },
  major: { label: '主要', cls: 'severity-major' },
  minor: { label: '轻微', cls: 'severity-minor' }
}

export function formatStage(stage: string): string {
  return STAGE_LABELS[stage] || stage
}

export function formatDateTime(value?: string): string {
  if (!value) return '暂无记录'
  return new Date(value).toLocaleString('zh-CN')
}

export function buildReviewKey(episodeNum: number | null, review: ReviewResult): string {
  return `${episodeNum ?? 'global'}-${review.stage}-${review.createdAt}-${review.result}-${review.score}`
}

export function getEpisodeStatusLabel(status: string): string {
  const map: Record<string, string> = {
    idle: '未进入制作',
    director: '导演阶段',
    art: '美术阶段',
    storyboard: '分镜阶段',
    complete: '制作完成'
  }
  return map[status] || status
}
