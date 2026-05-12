import { collectEpisodeReviews } from './review-history'
import type { Episode, ProjectPipelineState, ReviewResult } from '@shared/types'

export interface ReviewPageStats {
  totalReviews: number
  passCount: number
  failCount: number
  avgScore: number
  totalIssues: number
  criticalCount: number
}

export interface ReviewPageViewModel {
  epList: number[]
  reviews: ReviewResult[]
  stats: ReviewPageStats
}

export function buildReviewPageViewModel(params: {
  historicalState: ProjectPipelineState | null
  selectedEp: number | 'all'
  sessionReviews: ReviewResult[]
  currentSessionEpisodeNum?: number
  episodes: Episode[]
}): ReviewPageViewModel {
  const reviews = collectEpisodeReviews(
    params.historicalState,
    params.selectedEp,
    params.sessionReviews,
    params.currentSessionEpisodeNum
  )
  const epList = params.episodes
    .map((e) => e.episodeNumber)
    .sort((a, b) => a - b)
  const totalReviews = reviews.length
  const passCount = reviews.filter((r) => r.result === 'PASS').length
  const failCount = reviews.filter((r) => r.result === 'FAIL').length
  const avgScore =
    totalReviews > 0
      ? Math.round(
          (reviews.reduce((sum, review) => sum + review.score, 0) /
            totalReviews) *
            10
        ) / 10
      : 0
  const totalIssues = reviews.reduce(
    (sum, review) => sum + review.issues.length,
    0
  )
  const criticalCount = reviews.reduce(
    (sum, review) =>
      sum +
      review.issues.filter((issue) => issue.severity === 'critical').length,
    0
  )

  return {
    epList,
    reviews,
    stats: {
      totalReviews,
      passCount,
      failCount,
      avgScore,
      totalIssues,
      criticalCount
    }
  }
}
