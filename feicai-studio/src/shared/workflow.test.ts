import { describe, expect, it } from 'vitest'
import {
  countCompletedEpisodes,
  deriveEpisodeStatus,
  getEpisodeProgress,
  getEpisodeStageMeta,
  normalizeProjectConfig
} from './workflow'
import type { Episode } from './types'

describe('workflow', () => {
  it('按最靠后的产物推导集状态', () => {
    expect(
      deriveEpisodeStatus({
        hasSourceNovel: true,
        hasStoryBeat: true,
        hasScript: true,
        hasScriptReview: true,
        hasDirectorAnalysis: true,
        hasCharacterDesign: true,
        hasArtDesign: true,
        hasStoryboard: false,
        hasSeedancePrompts: false,
        hasStoryboardReview: false
      })
    ).toBe('art')

    expect(
      deriveEpisodeStatus({
        hasSourceNovel: false,
        hasStoryBeat: false,
        hasScript: true,
        hasScriptReview: true,
        hasDirectorAnalysis: false,
        hasCharacterDesign: false,
        hasArtDesign: false,
        hasStoryboard: false,
        hasSeedancePrompts: false,
        hasStoryboardReview: false
      })
    ).toBe('script_approved')

    expect(
      deriveEpisodeStatus({
        hasSourceNovel: false,
        hasStoryBeat: false,
        hasScript: false,
        hasScriptReview: false,
        hasDirectorAnalysis: false,
        hasCharacterDesign: false,
        hasArtDesign: false,
        hasStoryboard: false,
        hasSeedancePrompts: false,
        hasStoryboardReview: false
      })
    ).toBe('idle')
  })

  it('归一化项目配置时补默认目录与入口阶段', () => {
    const config = normalizeProjectConfig({
      projectName: 'Test',
      totalEpisodes: 12
    })

    expect(config.entryStage).toBe('novel')
    expect(config.workflowVersion).toBe(2)
    expect(config.directories?.sourceDir).toBe('source')
    expect(config.directories?.reviewsDir).toBe('reviews')
  })

  it('阶段元数据和完成统计正确', () => {
    expect(getEpisodeStageMeta('idle').progress).toBe(0)
    expect(getEpisodeStageMeta('complete').done).toBe(true)
    expect(getEpisodeProgress('script_approved')).toBeGreaterThan(0)

    const episodes = [
      { status: 'complete' },
      { status: 'script' },
      { status: 'complete' }
    ] as Episode[]

    expect(countCompletedEpisodes(episodes)).toBe(2)
  })
})
