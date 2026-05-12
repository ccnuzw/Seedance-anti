import { describe, expect, it } from 'vitest'
import type { Episode, ProjectConfig } from '@shared/types'
import {
  resolvePipelineDisplayState,
  resolvePipelineSummary,
  shouldShowCompleteBanner
} from './pipeline-page-view'

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

const baseConfig: ProjectConfig = {
  projectName: '项目',
  totalEpisodes: 12,
  visualStyle: '现实',
  targetMedium: '短剧',
  createdAt: '2026-05-07T00:00:00.000Z',
  entryStage: 'story',
  workflowMode: 'story_to_shortdrama'
}

describe('pipeline-page-view', () => {
  it('引擎匹配时使用实时状态，不匹配时回退到 episode 状态映射', () => {
    expect(
      resolvePipelineDisplayState({
        isEngineMatch: true,
        engineState: 'director_reviewing',
        episodeStatus: 'script_approved'
      })
    ).toBe('director_reviewing')

    expect(
      resolvePipelineDisplayState({
        isEngineMatch: false,
        engineState: 'director_reviewing',
        episodeStatus: 'storyboard_review'
      })
    ).toBe('storyboard_reviewing')
  })

  it('能生成摘要区展示数据', () => {
    const summary = resolvePipelineSummary({
      projectConfig: baseConfig,
      episode: createEpisode({ status: 'script_approved' }),
      automationGate: '已开放自动执行段',
      automationReady: true
    })

    expect(summary.entryLabel).toBe('从剧情开始')
    expect(summary.workflowMode).toBe('story_to_shortdrama')
    expect(summary.currentStageLabel).toBe('剧本已通过')
    expect(summary.progress).toBeGreaterThan(0)
    expect(summary.automationGate).toBe('已开放自动执行段')
    expect(summary.automationReady).toBe(true)
  })

  it('仅在 episode 完成时显示完成横幅', () => {
    expect(
      shouldShowCompleteBanner(createEpisode({ status: 'complete' }))
    ).toBe(true)
    expect(
      shouldShowCompleteBanner(createEpisode({ status: 'director' }))
    ).toBe(false)
  })
})
