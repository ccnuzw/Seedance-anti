import { describe, expect, it } from 'vitest'
import {
  buildWorkflowActionCards,
  getWorkflowReportStatus,
  getWorkflowReportTitle
} from './workflow-action-panel-config'
import type { Episode } from '@shared/types'
import type { WorkflowAvailabilityMap } from '@renderer/utils/pipeline-view'

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

function createAvailability(): WorkflowAvailabilityMap {
  return {
    story: { canStart: false, reason: '缺少原文' },
    story_review: { canStart: true, reason: 'ok' },
    script: { canStart: true, reason: 'ok' },
    script_review: { canStart: true, reason: 'ok' },
    character: { canStart: false, reason: '缺少导演分析' },
    storyboard_review: { canStart: false, reason: '缺少 prompts' }
  }
}

describe('workflow-action-panel-config', () => {
  it('会根据 episode 与 availability 生成动作卡状态', () => {
    const cards = buildWorkflowActionCards(
      createEpisode({ hasScript: true, hasStoryboardReview: true }),
      createAvailability()
    )

    expect(cards.find((card) => card.id === 'story')).toMatchObject({
      stateLabel: '未开放',
      stateClassName: 'blocked'
    })
    expect(cards.find((card) => card.id === 'script')).toMatchObject({
      stateLabel: '已存在',
      stateClassName: 'done'
    })
    expect(cards.find((card) => card.id === 'story_review')).toMatchObject({
      stateLabel: '可执行',
      stateClassName: 'ready'
    })
    expect(cards.find((card) => card.id === 'script_review')).toMatchObject({
      stateLabel: '可执行',
      stateClassName: 'ready'
    })
    expect(cards.find((card) => card.id === 'storyboard_review')).toMatchObject(
      {
        stateLabel: '已通过',
        stateClassName: 'done'
      }
    )
  })

  it('会返回报告标题和结果文案', () => {
    expect(getWorkflowReportTitle('character')).toBe('角色设计')
    expect(
      getWorkflowReportStatus({
        stage: 'script_review',
        success: false,
        review: {
          stage: 'script_review',
          reviewType: 'business',
          result: 'FAIL',
          passed: false,
          score: 6,
          feedback: '节奏不稳',
          issues: [],
          createdAt: '2026-05-07T00:00:00.000Z'
        }
      })
    ).toBe('未通过 6/10')
  })
})
