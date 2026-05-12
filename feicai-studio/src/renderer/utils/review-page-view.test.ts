import { describe, expect, it } from 'vitest'
import type { Episode, ProjectPipelineState, ReviewResult } from '@shared/types'
import { buildReviewPageViewModel } from './review-page-view'

function createEpisode(partial: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    projectId: 'project-1',
    episodeNumber: 1,
    title: '第1集',
    status: 'idle',
    hasStoryBeat: false,
    hasScript: false,
    hasScriptReview: false,
    hasDirectorAnalysis: false,
    hasCharacterDesign: false,
    hasArtDesign: false,
    hasStoryboard: false,
    hasSeedancePrompts: false,
    hasStoryboardReview: false,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

function createReview(partial: Partial<ReviewResult> = {}): ReviewResult {
  return {
    stage: 'script_review',
    reviewType: 'business',
    result: 'PASS',
    passed: true,
    score: 8,
    feedback: '通过',
    issues: [],
    createdAt: '2026-05-07T00:00:00.000Z',
    ...partial
  }
}

describe('review-page-view', () => {
  it('会合并历史和当前会话审核，并生成统计值', () => {
    const historicalState: ProjectPipelineState = {
      projectId: 'project-1',
      updatedAt: '2026-05-09T00:00:00.000Z',
      episodes: {
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
            createReview({
              stage: 'storyboard_review',
              result: 'FAIL',
              passed: false,
              score: 6,
              issues: [
                { severity: 'critical', description: '镜头不连续' },
                { severity: 'major', description: '节奏偏慢' }
              ],
              createdAt: '2026-05-08T00:00:00.000Z'
            })
          ],
          totalDurationSeconds: 95,
          updatedAt: '2026-05-08T00:00:00.000Z'
        }
      }
    }

    const model = buildReviewPageViewModel({
      historicalState,
      selectedEp: 'all',
      sessionReviews: [
        createReview({
          stage: 'director',
          score: 9,
          createdAt: '2026-05-09T00:00:00.000Z'
        })
      ],
      currentSessionEpisodeNum: 2,
      episodes: [
        createEpisode({ episodeNumber: 2 }),
        createEpisode({ episodeNumber: 1 })
      ]
    })

    expect(model.epList).toEqual([1, 2])
    expect(model.reviews).toHaveLength(2)
    expect(model.reviews[0]?.score).toBe(9)
    expect(model.stats.totalReviews).toBe(2)
    expect(model.stats.passCount).toBe(1)
    expect(model.stats.failCount).toBe(1)
    expect(model.stats.avgScore).toBe(7.5)
    expect(model.stats.totalIssues).toBe(2)
    expect(model.stats.criticalCount).toBe(1)
  })

  it('空数据时返回空列表和零统计', () => {
    const model = buildReviewPageViewModel({
      historicalState: null,
      selectedEp: 1,
      sessionReviews: [],
      currentSessionEpisodeNum: 1,
      episodes: []
    })

    expect(model.epList).toEqual([])
    expect(model.reviews).toEqual([])
    expect(model.stats).toEqual({
      totalReviews: 0,
      passCount: 0,
      failCount: 0,
      avgScore: 0,
      totalIssues: 0,
      criticalCount: 0
    })
  })
})
