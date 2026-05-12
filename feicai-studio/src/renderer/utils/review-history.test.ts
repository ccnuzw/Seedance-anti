import { describe, expect, it } from 'vitest'
import { collectEpisodeReviews, mergeReviewResults } from './review-history'
import type { ProjectPipelineState, ReviewResult } from '@shared/types'

function createReview(partial: Partial<ReviewResult>): ReviewResult {
  return {
    stage: 'script_review',
    reviewType: 'business',
    result: 'PASS',
    score: 8,
    passed: true,
    feedback: 'ok',
    issues: [],
    createdAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

describe('review-history', () => {
  it('会合并去重并按时间倒序排列审核结果', () => {
    const historical = [
      createReview({
        createdAt: '2026-05-07T00:00:00.000Z',
        stage: 'script_review'
      }),
      createReview({
        createdAt: '2026-05-05T00:00:00.000Z',
        stage: 'storyboard_review'
      })
    ]
    const session = [
      createReview({
        createdAt: '2026-05-07T00:00:00.000Z',
        stage: 'script_review',
        score: 7
      }),
      createReview({
        createdAt: '2026-05-08T00:00:00.000Z',
        stage: 'script_review',
        score: 9
      })
    ]

    const merged = mergeReviewResults(historical, session)

    expect(merged).toHaveLength(3)
    expect(merged[0].score).toBe(9)
    expect(merged[1].createdAt).toBe('2026-05-07T00:00:00.000Z')
  })

  it('能按集收集历史审核和当前会话审核', () => {
    const sessionReviews = [
      createReview({ createdAt: '2026-05-09T00:00:00.000Z', score: 6 })
    ]
    const historicalState: ProjectPipelineState = {
      projectId: 'p-1',
      updatedAt: '2026-05-10T00:00:00.000Z',
      episodes: {
        1: {
          episodeNum: 1,
          status: 'script_review',
          lastStage: 'script_review',
          completedStages: ['story', 'script'],
          stageStates: {},
          reviews: [
            createReview({ createdAt: '2026-05-08T00:00:00.000Z', score: 8 })
          ],
          totalDurationSeconds: 0,
          updatedAt: '2026-05-08T00:00:00.000Z'
        },
        2: {
          episodeNum: 2,
          status: 'storyboard_review',
          lastStage: 'storyboard_review',
          completedStages: [
            'story',
            'script',
            'script_review',
            'director',
            'character',
            'art',
            'storyboard'
          ],
          stageStates: {},
          reviews: [
            createReview({ createdAt: '2026-05-07T00:00:00.000Z', score: 7 })
          ],
          totalDurationSeconds: 100,
          updatedAt: '2026-05-07T00:00:00.000Z'
        }
      }
    }

    const currentEpisodeReviews = collectEpisodeReviews(
      historicalState,
      1,
      sessionReviews,
      1
    )
    const allReviews = collectEpisodeReviews(
      historicalState,
      'all',
      sessionReviews,
      1
    )

    expect(currentEpisodeReviews).toHaveLength(2)
    expect(currentEpisodeReviews[0].score).toBe(6)
    expect(allReviews).toHaveLength(3)
  })
})
