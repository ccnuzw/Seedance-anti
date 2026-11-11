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

  it('仅有提示词或只有审核标记不算完成，须两者同时存在', () => {
    const flags = {
      hasStoryBeat: true,
      hasScript: true,
      hasScriptReview: true,
      hasDirectorAnalysis: true,
      hasCharacterDesign: true,
      hasArtDesign: true,
      hasStoryboard: false,
      hasSeedancePrompts: true,
      hasStoryboardReview: false
    }
    expect(deriveEpisodeStatus(flags)).toBe('storyboard')
    expect(deriveEpisodeStatus({ ...flags, hasStoryboardReview: true })).toBe(
      'complete'
    )
    expect(
      deriveEpisodeStatus({
        ...flags,
        hasSeedancePrompts: false,
        hasStoryboardReview: true
      })
    ).not.toBe('complete')
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
