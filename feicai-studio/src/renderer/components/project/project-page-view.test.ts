import { describe, expect, it } from 'vitest'
import {
  getEpisodeCardSummary,
  getProjectEntryLabel,
  getProjectProgress
} from './project-page-view'
import type { Episode } from '@shared/types'

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

describe('project-page-view', () => {
  it('返回项目入口文案和进度摘要', () => {
    expect(getProjectEntryLabel({ entryStage: 'story' })).toBe('从剧情开始')
    expect(
      getProjectProgress([
        createEpisode({ status: 'complete' }),
        createEpisode({ id: 'ep-2', episodeNumber: 2, status: 'script' })
      ])
    ).toEqual({
      completedCount: 1,
      progressPct: 50
    })
  })

  it('返回单集卡片摘要', () => {
    expect(
      getEpisodeCardSummary(
        createEpisode({
          status: 'director',
          totalPrompts: 8,
          totalDurationSeconds: 90
        })
      )
    ).toEqual({
      stageLabel: '导演',
      progress: 62,
      promptCountLabel: '8 条提示词',
      durationLabel: '90s'
    })
  })
})
