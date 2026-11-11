import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import PipelinePage from './PipelinePage'
import PipelineSectionHeader from '@renderer/components/pipeline/PipelineSectionHeader'

vi.mock('@renderer/components/layout/LogPanel', () => ({ default: () => null }))

vi.mock('@renderer/hooks/usePipelinePageController', () => ({
  usePipelinePageController: () => ({ currentProject: null })
}))

describe('PipelinePage 可恢复的空状态', () => {
  it('没有项目数据时给出返回路径，不假设加载中或伪造加载失败', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(PipelinePage))
    )
    expect(html).toContain('尚未取得项目数据')
    expect(html).toContain('href="/"')
    expect(html).toContain('返回项目列表')
    expect(html).not.toContain('正在恢复')
    expect(html).not.toContain('spinner')
    expect(html).not.toContain('加载失败')
  })

  it('展开按钮暴露受控区域和展开状态', () => {
    const html = renderToStaticMarkup(
      createElement(PipelineSectionHeader, {
        title: '完整制作链',
        description: '查看适用阶段',
        buttonLabel: '展开完整链路',
        expanded: false,
        controls: 'pipeline-advanced-panel',
        onToggle: vi.fn()
      })
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="pipeline-advanced-panel"')
  })
})
