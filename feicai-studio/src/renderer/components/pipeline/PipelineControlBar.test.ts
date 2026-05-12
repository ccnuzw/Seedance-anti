import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PipelineControlBar from './PipelineControlBar'

function render(
  props?: Partial<Parameters<typeof PipelineControlBar>[0]>
): string {
  return renderToStaticMarkup(
    createElement(PipelineControlBar, {
      episodeNum: 1,
      displayState: 'idle',
      displayStartedAt: null,
      totalElapsed: 0,
      displayTimings: [],
      displayCurrentStage: null,
      stageElapsed: 0,
      displayIsRunning: false,
      isRunning: false,
      stageAvailability: {
        director: { canStart: true, reason: 'ok' },
        art: { canStart: false, reason: 'blocked' },
        storyboard: { canStart: false, reason: 'blocked' }
      },
      onStart: vi.fn(),
      onStop: vi.fn(),
      onSkipReview: vi.fn(),
      onRetry: vi.fn(),
      ...props
    })
  )
}

describe('PipelineControlBar', () => {
  it('空闲时渲染自动化启动按钮，并按门槛禁用对应阶段', () => {
    const html = render()

    expect(html).toContain('EP01')
    expect(html).toContain('▶ 执行自动化段')
    expect(html).toContain('🎬 导演')
    expect(html).toContain('🎨 服化道')
    expect(html).toContain('📐 分镜')
    expect(html).toContain('>🎬 导演</button>')
    expect(html).toContain('disabled="">🎨 服化道</button>')
    expect(html).toContain('disabled="">📐 分镜</button>')
    expect(html).not.toContain('⏹ 停止')
  })

  it('执行中且处于 reviewing 状态时显示停止与跳过审核按钮', () => {
    const html = render({
      displayState: 'director_reviewing',
      displayIsRunning: true,
      isRunning: true
    })

    expect(html).toContain('⏹ 停止')
    expect(html).toContain('⏭ 跳过审核')
    expect(html).not.toContain('▶ 执行自动化段')
  })

  it('错误态会额外显示重试按钮', () => {
    const html = render({
      displayState: 'error',
      displayIsRunning: false
    })

    expect(html).toContain('↻ 重试')
  })
})
