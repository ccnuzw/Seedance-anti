import { describe, expect, it } from 'vitest'
import {
  batchStatusLabel,
  batchTaskLabel,
  defaultBatchMode
} from './batch-presentation'

describe('batch presentation', () => {
  it('uses entry-appropriate defaults', () => {
    expect(
      ['novel', 'story', 'script'].map((entry) =>
        defaultBatchMode(entry as 'novel' | 'story' | 'script')
      )
    ).toEqual(['smart_next', 'script', 'full'])
  })
  it('never presents a stopped, paused, failed or idle queue as running', () => {
    for (const state of [
      'idle',
      'paused',
      'interrupted',
      'stopped',
      'error'
    ] as const)
      expect(batchStatusLabel(state, 0)).not.toContain('进行中')
    expect(batchStatusLabel('completed', 1)).toContain('失败')
    expect(batchStatusLabel('completed', 0)).toBe('队列已完成')
  })
  it('uses explicit batch identities only when present', () => {
    expect(batchTaskLabel({ episodeNum: 4, batchNumber: 9 })).toBe(
      '第 9 批剧情'
    )
    expect(batchTaskLabel({ episodeNum: 4 })).toBe('第 4 集')
  })
})
