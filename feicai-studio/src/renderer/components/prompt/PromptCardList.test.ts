import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { parsePromptsFromMarkdown } from '../../utils/prompt-markdown'
import PromptCardList from './PromptCardList'

describe('prompt cards after metadata filtering', () => {
  it('index zero is a real selectable prompt with duration, and later indices remain stable', () => {
    const prompts = parsePromptsFromMarkdown(
      '## 开场镜头\n时长：10秒\n开场。\n## 素材对应表\n元数据\n## 结束镜头\n时长：6.5秒\n结束。'
    )
    const render = (selectedIndex: number) =>
      renderToStaticMarkup(
        createElement(PromptCardList, {
          prompts,
          loading: false,
          selectedIndex,
          onSelect: vi.fn()
        })
      )
    const first = render(0)
    expect(first).toContain('card prompt-card selected')
    expect(first).toContain('>10s</span>')
    expect(first).toContain('>6.5s</span>')
    expect(first).not.toContain('prompt-card-ref-table')
    expect(first).not.toContain('素材对应表')
    expect(first).toContain('P02')
    const later = render(2)
    expect(later.indexOf('结束镜头')).toBeGreaterThan(
      later.indexOf('card prompt-card selected')
    )
    expect(later.indexOf('card prompt-card selected')).toBeGreaterThan(
      later.indexOf('开场镜头')
    )
  })
})
