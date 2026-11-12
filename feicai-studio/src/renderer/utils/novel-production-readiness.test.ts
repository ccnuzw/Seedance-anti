import { describe, expect, it } from 'vitest'
import { getNovelProductionReadiness as readiness } from './novel-production-readiness'
import { getWorkflowActionAvailability } from './pipeline-view'
import type { Episode } from '@shared/types'

const input = {
  hasSource: true,
  waterline: { readyEpisodeNumbers: [], usedEpisodeNumbers: [] },
  episodeNumber: 2,
  episode: { episodeNumber: 2, hasScript: false } as Episode
}
describe('novel production readiness', () => {
  it('fails closed on unknown and failed reads and offers refresh', () => {
    for (const unknown of [{ hasSource: null }, { waterline: null }]) {
      expect(readiness({ ...input, ...unknown })).toMatchObject({
        canStart: false,
        action: 'refresh'
      })
    }
    expect(
      getWorkflowActionAvailability(undefined, 'script', 'novel', true).canStart
    ).toBe(false)
  })
  it('directs missing source and empty inventory to their preparation pages', () => {
    expect(readiness({ ...input, hasSource: false })).toMatchObject({
      canStart: false,
      action: 'source'
    })
    expect(readiness(input)).toMatchObject({
      canStart: false,
      action: 'story',
      label: '准备剧情草稿'
    })
    expect(
      readiness({
        ...input,
        episode: { episodeNumber: 2, hasStoryBeat: true } as Episode
      }).label
    ).toBe('检查并审核剧情草稿')
  })
  it('accepts only target inventory without requiring an episode story review', () => {
    const ready = readiness({
      ...input,
      waterline: { readyEpisodeNumbers: [2], usedEpisodeNumbers: [] }
    })
    expect(ready.canStart).toBe(true)
    expect(
      getWorkflowActionAvailability(undefined, 'script', 'novel', true, ready)
        .canStart
    ).toBe(true)
    expect(
      readiness({
        ...input,
        waterline: { readyEpisodeNumbers: [1], usedEpisodeNumbers: [] }
      }).canStart
    ).toBe(false)
  })
  it('prioritizes existing script paths and flags and refreshes unknown episodes', () => {
    const ready = {
      ...input,
      waterline: { readyEpisodeNumbers: [2], usedEpisodeNumbers: [] }
    }
    expect(readiness({ ...ready, episode: undefined })).toMatchObject({
      canStart: false,
      action: 'refresh'
    })
    for (const artifact of [
      { hasScript: true },
      { scriptPath: '/synthetic/script.md' }
    ]) {
      expect(
        readiness({ ...ready, episode: { ...input.episode, ...artifact } })
      ).toMatchObject({ canStart: false, action: 'script' })
    }
  })
  it('blocks repeated consumption of used inventory without a script', () => {
    expect(
      readiness({
        ...input,
        waterline: { readyEpisodeNumbers: [2], usedEpisodeNumbers: [2] }
      })
    ).toMatchObject({ canStart: false, label: '核对已用剧情' })
  })
})
