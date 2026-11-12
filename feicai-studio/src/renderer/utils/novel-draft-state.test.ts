import { describe, expect, it } from 'vitest'
import {
  novelDraftState,
  novelReadyEpisode,
  novelNextAction
} from './novel-draft-state'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'

describe('novel draft identity', () => {
  it('never treats a template or episode slot as a generated batch', () => {
    expect(novelDraftState('# EP04 剧情拆解\n### Beat 1', null)).toEqual({
      batch: null,
      nextBatch: null
    })
  })
  it('uses inventory for the next batch and the marker for an existing draft', () => {
    const summary = { nextBatchNumber: 9 } as PlotBreakdownSummary
    expect(novelDraftState('', summary).nextBatch).toBe(9)
    expect(
      novelDraftState('<!-- feicai-story-batch:7 -->\n内容', summary).batch
    ).toBe(7)
  })
  it('filters ready minus used and existing scripts using only loaded own episodes', () => {
    const summary = {
      readyEpisodeNumbers: [3, 4, 5, 6],
      usedEpisodeNumbers: [3]
    } as PlotBreakdownSummary
    expect(novelReadyEpisode(summary, null, 'a')).toBeNull()
    expect(
      novelReadyEpisode(
        summary,
        [
          { projectId: 'a', episodeNumber: 4, hasScript: true },
          { projectId: 'a', episodeNumber: 5, scriptPath: 'existing' },
          { projectId: 'b', episodeNumber: 6, hasScript: true }
        ] as import('@shared/types').Episode[],
        'a'
      )
    ).toBe(6)
    expect(
      novelReadyEpisode({ ...summary, readyEpisodeNumbers: [3] }, [], 'a')
    ).toBeNull()
  })
  it('prioritizes pending review and offers explicit next batch or completion', () => {
    const summary = {
      nextBatchNumber: 8,
      unprocessedChapterCount: 6
    } as PlotBreakdownSummary
    expect(novelNextAction(7, false, summary, 12)).toBe('review')
    expect(novelNextAction(7, true, summary, null)).toBe('next')
    expect(
      novelNextAction(7, true, { ...summary, unprocessedChapterCount: 0 }, null)
    ).toBe('complete')
  })
  it('rejects zero and unsafe identities', () => {
    for (const id of ['0', '9007199254740992', '-3'])
      expect(
        novelDraftState(`<!-- feicai-story-batch:${id} -->`, null).batch
      ).toBeNull()
  })
})
