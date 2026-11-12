import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ProjectProductionMatrix, {
  type ProjectProductionMatrixProps
} from './ProjectProductionMatrix'
import type { ProductionRow } from '@renderer/utils/project-production-view'

function render(overrides: Partial<ProjectProductionMatrixProps> = {}) {
  return renderToStaticMarkup(
    createElement(ProjectProductionMatrix, {
      projectId: 'A',
      projectName: '当前项目A',
      entryLabel: '从剧本开始',
      rows: [],
      loading: false,
      error: null,
      warning: null,
      onRefresh: vi.fn(),
      onNavigate: vi.fn(),
      running: null,
      ...overrides
    })
  )
}
const row: ProductionRow = {
  episodeNumber: 1,
  title: '第一集',
  cells: [
    {
      stage: 'script',
      label: '剧本',
      status: '待审核',
      detail: '产物存在；缺少有效 PASS',
      applicable: true,
      satisfied: false,
      path: '/project/A/script?ep=1'
    }
  ],
  next: {
    stage: 'script',
    label: '剧本',
    status: '待审核',
    detail: '产物存在；缺少有效 PASS',
    applicable: true,
    satisfied: false,
    path: '/project/A/script?ep=1'
  },
  complete: false
}

describe('ProjectProductionMatrix', () => {
  it('offers a clear empty state and does not claim unknown data failed', () => {
    expect(render()).toContain('暂无集数')
    const html = render({ loading: true })
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('正在读取制作状态')
    expect(html).not.toContain('下一步：')
    expect(html).not.toContain('审核未通过')
  })
  it('separates browsing and global running project with its own navigation', () => {
    const html = render({
      running: { projectId: 'B', episodeNum: 8, stage: '导演' }
    })
    expect(html).toContain('当前浏览：当前项目A')
    expect(html).toContain('后台任务：项目 B')
    expect(html).toContain('第 8 集')
    expect(html).toContain('查看运行任务')
  })
  it('exposes accessible table headings, labeled buttons and a bounded page', () => {
    const html = render({
      rows: Array.from({ length: 1000 }, (_, i) => ({
        ...row,
        episodeNumber: i + 1,
        title: `第${i + 1}集`
      }))
    })
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).toContain('aria-label="第1集 剧本：待审核')
    expect(html).toContain('第 1 / 50 页')
    expect(html.match(/scope="row"/g)).toHaveLength(20)
    expect(html).toContain('处理第 1 集剧本')
  })
  it('hides actionable next steps on read failure or refresh', () => {
    const failed = render({ error: '读取失败，请刷新重试', rows: [] })
    expect(failed).toContain('role="alert"')
    expect(failed).not.toContain('暂无集数')
    const refreshing = render({ rows: [row], loading: true })
    expect(refreshing).toContain('下方为刷新前快照')
    expect(refreshing).not.toContain('处理第 1 集剧本')
    expect(refreshing).toContain('disabled=""')
  })
})
