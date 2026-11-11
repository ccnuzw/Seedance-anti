import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipelineContext, Project } from '@shared/types'
import Sidebar from './Sidebar'
import { usePipelinePageController } from '@renderer/hooks/usePipelinePageController'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'

// Keep real stores and project switching; SSR reads the selected live snapshot.
vi.mock('@renderer/stores/projectStore', async (importOriginal) => {
  const { useProjectStore: store } =
    await importOriginal<typeof import('@renderer/stores/projectStore')>()
  return {
    useProjectStore: Object.assign(
      (select: (state: ReturnType<typeof store.getState>) => unknown) =>
        select(store.getState()),
      store
    )
  }
})

vi.mock('@renderer/stores/pipelineStore', async (importOriginal) => {
  const { usePipelineStore: store } =
    await importOriginal<typeof import('@renderer/stores/pipelineStore')>()
  return {
    usePipelineStore: Object.assign(
      (select: (state: ReturnType<typeof store.getState>) => unknown) =>
        select(store.getState()),
      store
    )
  }
})

// No Electron IPC or running task is invoked by this navigation regression.
vi.mock('@renderer/services/pipeline-service', () => ({
  pipelineEvents: {},
  abortPipeline: vi.fn(),
  getPipelineState: vi.fn(),
  pausePipeline: vi.fn(),
  retryPipeline: vi.fn(),
  skipPipeline: vi.fn(),
  startPipeline: vi.fn()
}))

function project(id: string): Project {
  return {
    id,
    name: id,
    visualStyle: '',
    targetMedium: '短剧',
    projectPath: `/temporary/${id}`,
    totalEpisodes: 10,
    config: {
      projectName: id,
      totalEpisodes: 10,
      visualStyle: '',
      targetMedium: '短剧',
      entryStage: 'script',
      workflowMode: 'script_to_shortdrama',
      createdAt: ''
    },
    createdAt: '',
    updatedAt: ''
  }
}

function ControllerProbe() {
  const { commandCenter } = usePipelinePageController()
  return createElement('output', {
    'data-episode': commandCenter.episodeNum,
    'data-display-running': commandCenter.displayIsRunning,
    'data-global-running': commandCenter.isRunning
  })
}

function renderNavigation(path: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Sidebar),
      createElement(ControllerProbe)
    )
  )
}

const runningContext: PipelineContext = {
  projectId: 'project-A',
  projectPath: '/temporary/project-A',
  episodeNum: 7,
  currentStage: 'director',
  state: 'director_analyzing',
  retryCount: 0,
  running: true,
  reviews: [],
  logs: []
}

beforeEach(() => {
  useProjectStore.getState().setCurrentProject(null)
  usePipelineStore.setState({
    context: runningContext,
    state: 'director_analyzing',
    isRunning: true,
    stageTimings: [],
    currentStageName: 'director',
    pipelineStartedAt: null
  })
})

describe('Sidebar 与制作总控的项目集号归属', () => {
  it('A 第 7 集运行时切 B 不携带 A 集号，切回 A 保留原任务', () => {
    useProjectStore.getState().setCurrentProject(project('project-A'))
    const initial = renderNavigation('/project/project-A/pipeline')
    expect(initial).toContain('href="/project/project-A/pipeline?ep=7"')
    expect(initial).toContain('data-episode="7"')
    expect(initial).toContain('data-display-running="true"')

    useProjectStore.getState().setCurrentProject(project('project-B'))
    const switched = renderNavigation('/project/project-B/pipeline')
    expect(switched).toContain('href="/project/project-B/pipeline"')
    expect(switched).not.toContain('/project/project-B/pipeline?ep=7')
    expect(switched).toContain('data-episode="1"')
    expect(switched).toContain('data-display-running="false"')
    expect(switched).toContain('data-global-running="true"')

    expect(usePipelineStore.getState().context).toBe(runningContext)
    expect(usePipelineStore.getState().isRunning).toBe(true)
    useProjectStore.getState().setCurrentProject(project('project-A'))
    expect(renderNavigation('/project/project-A/pipeline')).toContain(
      'href="/project/project-A/pipeline?ep=7"'
    )
  })

  it('B 的显式集号优先，即使集号与 A 相同也不显示 A 的运行状态', () => {
    useProjectStore.getState().setCurrentProject(project('project-B'))
    for (const episode of [3, 7]) {
      const html = renderNavigation(`/project/project-B/pipeline?ep=${episode}`)
      expect(html).toContain(`data-episode="${episode}"`)
      expect(html).toContain('data-display-running="false"')
    }
  })

  it('结束的上下文也只属于原项目，无项目时不生成流水线链接', () => {
    usePipelineStore.setState({ isRunning: false })
    useProjectStore.getState().setCurrentProject(project('project-A'))
    expect(renderNavigation('/project/project-A/pipeline')).toContain(
      'href="/project/project-A/pipeline?ep=7"'
    )
    useProjectStore.getState().setCurrentProject(project('project-B'))
    expect(renderNavigation('/project/project-B/pipeline')).toContain(
      'data-episode="1"'
    )
    useProjectStore.getState().setCurrentProject(null)
    const html = renderNavigation('/')
    expect(html).not.toContain('href="/project/')
    expect(html).toContain('data-episode="1"')
  })
})
