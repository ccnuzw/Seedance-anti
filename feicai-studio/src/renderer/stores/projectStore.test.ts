import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Episode, Project } from '@shared/types'

const listProjects = vi.fn()
const getProject = vi.fn()
const createProject = vi.fn()
const updateProject = vi.fn()
const deleteProject = vi.fn()
const listProjectEpisodes = vi.fn()
const syncProjectStatus = vi.fn()
const syncSingleEpisodeStatus = vi.fn()
const selectDirectory = vi.fn()
const clearCachedTextFiles = vi.fn()

vi.mock('@renderer/services/project-service', () => ({
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  listProjectEpisodes,
  syncProjectStatus,
  syncSingleEpisodeStatus
}))

vi.mock('@renderer/services/file-io', () => ({
  selectDirectory
}))

vi.mock('@renderer/services/file-cache', () => ({
  clearCachedTextFiles
}))

const baseProject: Project = {
  id: 'project-1',
  name: '项目',
  visualStyle: '现实',
  targetMedium: '短剧',
  projectPath: '/tmp/project',
  totalEpisodes: 3,
  config: {
    projectName: '项目',
    totalEpisodes: 3,
    visualStyle: '现实',
    targetMedium: '短剧',
    createdAt: '2026-05-07T00:00:00.000Z'
  },
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z'
}

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

describe('useProjectStore', async () => {
  const { useProjectStore } = await import('./projectStore')

  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      projects: [],
      currentProject: baseProject,
      episodes: [
        createEpisode({ id: 'ep-1', episodeNumber: 1, status: 'script' }),
        createEpisode({ id: 'ep-3', episodeNumber: 3, status: 'idle' })
      ],
      loading: false
    })
  })

  it('同步单集状态时会先清理缓存并覆盖已有 episode', async () => {
    syncSingleEpisodeStatus.mockResolvedValue(
      createEpisode({
        id: 'ep-1',
        episodeNumber: 1,
        status: 'director',
        hasDirectorAnalysis: true
      })
    )

    await useProjectStore.getState().syncSingleEpisodeStatus(1)

    expect(clearCachedTextFiles).toHaveBeenCalledTimes(1)
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 1
    })

    const state = useProjectStore.getState()
    expect(state.episodes).toHaveLength(2)
    expect(state.episodes[0]?.status).toBe('director')
    expect(state.episodes[0]?.hasDirectorAnalysis).toBe(true)
  })

  it('同步单集状态时会按集数顺序插入新 episode', async () => {
    syncSingleEpisodeStatus.mockResolvedValue(
      createEpisode({ id: 'ep-2', episodeNumber: 2, status: 'script' })
    )

    await useProjectStore.getState().syncSingleEpisodeStatus(2)

    expect(clearCachedTextFiles).toHaveBeenCalledTimes(1)
    expect(
      useProjectStore.getState().episodes.map((item) => item.episodeNumber)
    ).toEqual([1, 2, 3])
  })

  it('更新项目时会刷新 currentProject、项目列表和 episodes', async () => {
    const updatedProject: Project = {
      ...baseProject,
      name: '新项目',
      visualStyle: '赛博写实',
      targetMedium: '竖屏短剧',
      totalEpisodes: 6,
      config: {
        ...baseProject.config,
        projectName: '新项目',
        visualStyle: '赛博写实',
        targetMedium: '竖屏短剧',
        totalEpisodes: 6
      }
    }
    updateProject.mockResolvedValue(updatedProject)
    listProjectEpisodes.mockResolvedValue([
      createEpisode({ id: 'ep-1', episodeNumber: 1 }),
      createEpisode({ id: 'ep-2', episodeNumber: 2 })
    ])
    useProjectStore.setState({
      projects: [baseProject],
      currentProject: baseProject,
      episodes: [createEpisode({ id: 'ep-1', episodeNumber: 1 })],
      loading: false
    })

    await useProjectStore.getState().updateProject('project-1', {
      name: '新项目',
      visualStyle: '赛博写实',
      targetMedium: '竖屏短剧',
      totalEpisodes: 6
    })

    expect(updateProject).toHaveBeenCalledWith('project-1', {
      name: '新项目',
      visualStyle: '赛博写实',
      targetMedium: '竖屏短剧',
      totalEpisodes: 6
    })
    expect(listProjectEpisodes).toHaveBeenCalledWith('project-1')
    expect(useProjectStore.getState().currentProject?.name).toBe('新项目')
    expect(useProjectStore.getState().projects[0]?.name).toBe('新项目')
    expect(useProjectStore.getState().episodes).toHaveLength(2)
  })
})
