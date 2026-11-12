import { describe, expect, it } from 'vitest'
import { novelDraftState } from './novel-draft-state'
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
  it('rejects zero and unsafe identities', () => {
    for (const id of ['0', '9007199254740992', '-3'])
      expect(
        novelDraftState(`<!-- feicai-story-batch:${id} -->`, null).batch
      ).toBeNull()
  })
})
