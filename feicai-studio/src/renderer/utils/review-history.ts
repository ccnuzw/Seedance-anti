import type {
  EpisodePipelineState,
  ProjectPipelineState,
  ReviewResult
} from '@shared/types'

export function mergeReviewResults(
  historical: ReviewResult[],
  session: ReviewResult[]
): ReviewResult[] {
  const allReviews = [...historical]
  for (const sr of session) {
    const exists = allReviews.find(
      (r) => r.createdAt === sr.createdAt && r.stage === sr.stage
    )
    if (!exists) allReviews.push(sr)
  }
  return allReviews.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export function collectEpisodeReviews(
  historicalState: ProjectPipelineState | null,
  selectedEp: number | 'all',
  sessionReviews: ReviewResult[],
  currentSessionEpisodeNum?: number
): ReviewResult[] {
  if (!historicalState?.episodes) {
    return sessionReviews
  }

  if (selectedEp === 'all') {
    const historicalReviews = Object.values(historicalState.episodes).flatMap(
      (ep: EpisodePipelineState) => ep.reviews || []
    )
    return mergeReviewResults(historicalReviews, sessionReviews)
  }

  const epState = historicalState.episodes[selectedEp]
  const historical = epState?.reviews || []
  const session = sessionReviews.filter(
    () => currentSessionEpisodeNum === selectedEp
  )
  return mergeReviewResults(historical, session)
}
