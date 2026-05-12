import { create } from 'zustand'
import type { ReviewResult, ReviewStage } from '@shared/types'

function buildKey(
  projectPath: string,
  episodeNum: number,
  stage: ReviewStage
): string {
  return `${projectPath}::${episodeNum}::${stage}`
}

interface ReviewFeedbackStore {
  byKey: Record<string, ReviewResult>
  setReview: (
    projectPath: string,
    episodeNum: number,
    review: ReviewResult
  ) => void
  getReview: (
    projectPath: string,
    episodeNum: number,
    stage: ReviewStage
  ) => ReviewResult | null
}

export const useReviewFeedbackStore = create<ReviewFeedbackStore>(
  (set, get) => ({
    byKey: {},

    setReview: (projectPath, episodeNum, review) => {
      const key = buildKey(projectPath, episodeNum, review.stage)
      set((state) => ({
        byKey: {
          ...state.byKey,
          [key]: review
        }
      }))
    },

    getReview: (projectPath, episodeNum, stage) => {
      const key = buildKey(projectPath, episodeNum, stage)
      return get().byKey[key] || null
    }
  })
)
