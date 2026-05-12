import { useEffect, useState } from 'react'
import { useReviewFeedbackStore } from '@renderer/stores/reviewFeedbackStore'
import {
  loadLatestReviewFromFile,
  pickLatestReview
} from '@renderer/utils/reviewFeedback'
import type { ReviewResult, ReviewStage } from '@shared/types'

export function useLatestStageReview(
  projectPath: string | undefined,
  episodeNum: number,
  stage: ReviewStage
) {
  const cachedReview = useReviewFeedbackStore((s) =>
    projectPath && episodeNum > 0
      ? s.byKey[`${projectPath}::${episodeNum}::${stage}`] || null
      : null
  )
  const [latestReview, setLatestReview] = useState<ReviewResult | null>(null)

  useEffect(() => {
    if (!projectPath || episodeNum <= 0) {
      setLatestReview(null)
      return
    }

    let cancelled = false
    ;(async () => {
      const fileReview = await loadLatestReviewFromFile(
        projectPath,
        episodeNum,
        stage
      )
      if (!cancelled) {
        setLatestReview(pickLatestReview(fileReview, cachedReview))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectPath, episodeNum, stage, cachedReview])

  return latestReview
}
