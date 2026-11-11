import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkflowActionPanel from './WorkflowActionPanel'
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
    story_review: { canStart: false, reason: '缺少剧情拆解' },
    script: { canStart: true, reason: 'ok' },
    script_review: { canStart: true, reason: 'ok' },
    character: { canStart: false, reason: '缺少导演分析' },
    storyboard_review: { canStart: false, reason: '缺少 prompts' }
  }
}

function render(
  props?: Partial<Parameters<typeof WorkflowActionPanel>[0]>
): string {
  return renderToStaticMarkup(
    createElement(WorkflowActionPanel, {
      currentEpisode: createEpisode(),
      workflowAvailability: createAvailability(),
      workflowAction: null,
      workflowReport: null,
      displayIsRunning: false,
      onAction: vi.fn(),
      ...props
    })
  )
}

describe('WorkflowActionPanel', () => {
  it('按可执行性启用和禁用动作按钮', () => {
    const html = render({
      currentEpisode: createEpisode({ hasScript: true })
    })
    const buttons = html.match(/<button\b[^>]*>/g) ?? []
    const availableCount = Object.values(createAvailability()).filter(
      ({ canStart }) => canStart
    ).length

    expect(buttons).toHaveLength(Object.keys(createAvailability()).length)
    expect(
      buttons.filter((button) => !button.includes('disabled'))
    ).toHaveLength(availableCount)
  })

  it('执行中时禁用所有动作按钮', () => {
    const html = render({
      workflowAction: 'script_review',
      displayIsRunning: true
    })
    const buttons = html.match(/<button\b[^>]*>/g) ?? []

    expect(buttons).not.toHaveLength(0)
    expect(buttons.every((button) => button.includes('disabled'))).toBe(true)
  })

  it('有执行报告时渲染结果、产物路径和审核反馈', () => {
    const html = render({
      workflowReport: {
        stage: 'storyboard_review',
        success: false,
        outputPath: '/tmp/reviews/storyboard/ep01.md',
        error: '审核未通过',
        review: {
          stage: 'storyboard_review',
          reviewType: 'business',
          result: 'FAIL',
          passed: false,
          score: 6,
          feedback: '镜头节奏偏乱',
          issues: [],
          createdAt: '2026-05-07T00:00:00.000Z'
        }
      }
    })

    expect(html).toContain('/tmp/reviews/storyboard/ep01.md')
    expect(html).toContain('审核未通过')
    expect(html).toContain('镜头节奏偏乱')
  })
})
