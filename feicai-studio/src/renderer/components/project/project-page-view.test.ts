import { describe, expect, it } from 'vitest'
import { getProjectProgress } from './project-page-view'
import type { Episode } from '@shared/types'

function createEpisode(partial: Partial<Episode> = {}): Episode {
  return {
    id: 'ep-1',
    projectId: 'project-1',
    episodeNumber: 1,
    title: '第1集',
    status: 'idle',
    hasStoryBeat: false,
    hasStoryReview: false,
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
  it('按已完成集数计算项目进度', () => {
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
})
