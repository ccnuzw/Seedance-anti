import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectPage from './ProjectPage'
import { useProjectPageController } from '@renderer/hooks/useProjectPageController'
import type { ProjectEntryStage } from '@shared/types'

vi.mock('@renderer/hooks/useProjectPageController', () => ({
  useProjectPageController: vi.fn()
}))
vi.mock('@renderer/stores/pipelineStore', () => ({
  usePipelineStore: (select: (s: object) => unknown) =>
    select({ context: null, isRunning: false })
}))
vi.mock('@renderer/components/project/ProjectPipelineSettingsPanel', () => ({
  default: () => createElement('div', null, '项目设置')
}))

function setup(entry: ProjectEntryStage = 'script', hasProject = true) {
  vi.mocked(useProjectPageController).mockReturnValue({
    currentProject: hasProject
      ? {
          id: 'A',
          name: '项目A',
          totalEpisodes: 0,
          visualStyle: '',
          targetMedium: '',
          config: { entryStage: entry }
        }
      : null,
    productionRows: [],
    productionLoading: false,
    productionError: null,
    productionWarning: null,
    plotBreakdownSummary: null,
    entryLabel: `从${entry}开始`,
    navigate: vi.fn(),
    handleRefreshStatus: vi.fn()
  } as unknown as ReturnType<typeof useProjectPageController>)
}
function render() {
  return renderToStaticMarkup(createElement(ProjectPage))
}

beforeEach(() => vi.clearAllMocks())
describe('ProjectPage production overview', () => {
  it('recovers no-project selection without reading a missing snapshot', () => {
    setup('script', false)
    expect(render()).toContain('选择一个项目')
    expect(render()).not.toContain('分集制作矩阵')
  })
  it.each(['script', 'story'] as const)(
    'keeps %s entry focused on available stages without novel inventory controls',
    (entry) => {
      setup(entry)
      const html = render()
      expect(html).toContain('分集制作矩阵')
      expect(html).toContain('项目设置')
      expect(html).not.toContain('剧情库存水位')
      expect(html).not.toContain('章节扫描')
      expect(html).not.toContain('视频生成')
      expect(html).not.toContain('图片生成')
    }
  )
  it('shows unknown novel inventory without inventing zero counts or completion', () => {
    setup('novel')
    const html = render()
    expect(html).toContain('剧情库存水位：')
    expect(html).toContain('状态未取得')
    expect(html).not.toContain('库存充足')
    expect(html).not.toContain('已完成')
  })
})
