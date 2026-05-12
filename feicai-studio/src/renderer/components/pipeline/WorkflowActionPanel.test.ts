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
  it('按 episode 状态与可执行性渲染动作卡状态和禁用态', () => {
    const html = render({
      currentEpisode: createEpisode({ hasScript: true })
    })

    expect(html).toContain('🧩 剧情拆解')
    expect(html).toContain('未开放')
    expect(html).toContain('📖 剧本生成')
    expect(html).toContain('已存在')
    expect(html).toContain('📝 剧本审核')
    expect(html).toContain('可执行')
    expect(html).toContain('disabled="">执行剧情拆解</button>')
    expect(html).toContain('>执行剧本审核</button>')
  })

  it('执行中时展示对应阶段的执行中文案，并整体禁用按钮', () => {
    const html = render({
      workflowAction: 'script_review',
      displayIsRunning: true
    })

    expect(html).toContain('执行中...')
    expect(html).toContain('disabled="">执行中...</button>')
    expect(html).toContain('disabled="">执行剧本生成</button>')
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

    expect(html).toContain('分镜审核')
    expect(html).toContain('未通过 6/10')
    expect(html).toContain('产物已写入：/tmp/reviews/storyboard/ep01.md')
    expect(html).toContain('审核未通过')
    expect(html).toContain('镜头节奏偏乱')
  })
})
