import { describe, expect, it } from 'vitest'
import type { Episode, ProjectPipelineState } from '@shared/types'
import {
  buildProjectExperienceSummary,
  buildStageDrilldownSummary
} from './project-experience-view'

function createEpisode(partial: Partial<Episode> = {}): Episode {
  return {
    id: `ep-${partial.episodeNumber || 1}`,
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
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    ...partial
  }
}

describe('project-experience-view', () => {
  it('汇总项目体验概览、阶段覆盖和最近活跃集数', () => {
    const episodes = [
      createEpisode({
        episodeNumber: 1,
        title: '第1集',
        status: 'complete',
        hasStoryBeat: true,
        hasScript: true,
        hasScriptReview: true,
        hasDirectorAnalysis: true,
        hasCharacterDesign: true,
        hasArtDesign: true,
        hasStoryboard: true,
        hasSeedancePrompts: true,
        updatedAt: '2026-05-08T10:00:00.000Z'
      }),
      createEpisode({
        episodeNumber: 2,
        title: '第2集',
        status: 'script',
        hasStoryBeat: true,
        hasScript: true,
        updatedAt: '2026-05-08T12:00:00.000Z'
      }),
      createEpisode({
        episodeNumber: 3,
        title: '第3集',
        status: 'idle',
        updatedAt: '2026-05-08T08:00:00.000Z'
      })
    ]

    const pipelineState: ProjectPipelineState = {
      projectId: 'project-1',
      updatedAt: '2026-05-08T12:30:00.000Z',
      episodes: {
        2: {
          episodeNum: 2,
          status: 'script',
          lastStage: 'script',
          completedStages: ['story', 'script'],
          stageStates: {},
          reviews: [
            {
              stage: 'script_review',
              reviewType: 'business',
              result: 'FAIL',
              passed: false,
              score: 6,
              feedback: '节奏不足',
              issues: [{ severity: 'major', description: '节奏拖沓' }],
              createdAt: '2026-05-08T12:10:00.000Z'
            }
          ],
          totalDurationSeconds: 0,
          updatedAt: '2026-05-08T12:20:00.000Z'
        }
      }
    }

    const summary = buildProjectExperienceSummary({
      episodes,
      config: { entryStage: 'story' },
      projectPipelineState: pipelineState,
      readyItems: [
        {
          label: '项目配置',
          path: '/tmp/project/project-config.json',
          exists: true
        },
        {
          label: '小说原文',
          path: '/tmp/project/source/novel.md',
          exists: false
        }
      ],
      integrityReport: {
        status: 'warn',
        summary: '项目可导入，但存在缺失项',
        detectedEpisodes: 3,
        expectedEpisodes: 5,
        checks: [],
        recommendedActions: []
      },
      projectId: 'project-1'
    })

    expect(summary.entryLabel).toBe('从剧情开始')
    expect(summary.progressPct).toBe(33)
    expect(summary.completedCount).toBe(1)
    expect(summary.inProgressCount).toBe(1)
    expect(summary.idleCount).toBe(1)
    expect(summary.latestActiveEpisode).toBe(2)
    expect(summary.latestPipelineStatus).toBe('2 集 · 剧本已生成')
    expect(summary.pipelineUpdatedAt).toBe('2026-05-08T12:30:00.000Z')
    expect(summary.currentFocusStageLabel).toBe('剧本审核中')
    expect(summary.healthScore.score).toBeGreaterThan(0)
    expect(['C', 'D']).toContain(summary.healthScore.grade)
    expect(
      summary.stageCoverage.find((item) => item.key === 'script')?.count
    ).toBe(2)
    expect(
      summary.stageCoverage.find((item) => item.key === 'storyboard')?.count
    ).toBe(1)
    expect(
      summary.stageTimeline.find((item) => item.id === 'novel')?.state
    ).toBe('done')
    expect(
      summary.stageTimeline.find((item) => item.id === 'script_review')?.state
    ).toBe('active')
    expect(
      summary.stageTimeline.find((item) => item.id === 'complete')?.state
    ).toBe('upcoming')
    expect(summary.risks.map((item) => item.id)).toContain('review-failure')
    expect(summary.risks.map((item) => item.id)).toContain(
      'episode-coverage-gap'
    )
    expect(summary.risks[0].severity).toBe('high')
    expect(summary.recentEpisodes.map((item) => item.episodeNumber)).toEqual([
      2, 1, 3
    ])
  })

  it('按阶段下钻划分已到达、卡住和未到达的集数', () => {
    const episodes = [
      createEpisode({
        episodeNumber: 1,
        title: '第1集',
        status: 'complete',
        hasStoryBeat: true,
        hasScript: true,
        hasScriptReview: true,
        hasDirectorAnalysis: true,
        hasCharacterDesign: true,
        hasArtDesign: true,
        hasStoryboard: true,
        hasSeedancePrompts: true
      }),
      createEpisode({
        episodeNumber: 2,
        title: '第2集',
        status: 'script',
        hasStoryBeat: true,
        hasScript: true
      }),
      createEpisode({
        episodeNumber: 3,
        title: '第3集',
        status: 'story',
        hasStoryBeat: true
      })
    ]

    const drilldown = buildStageDrilldownSummary({
      episodes,
      stageId: 'script'
    })

    expect(drilldown.stageLabel).toBe('剧本已生成')
    expect(drilldown.reached.map((item) => item.episodeNumber)).toEqual([1])
    expect(drilldown.blocked.map((item) => item.episodeNumber)).toEqual([2])
    expect(drilldown.pending.map((item) => item.episodeNumber)).toEqual([3])
  })
})
