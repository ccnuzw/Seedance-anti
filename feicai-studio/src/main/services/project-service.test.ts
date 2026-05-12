import { beforeEach, describe, expect, it, vi } from 'vitest'

const createProjectRecord = vi.fn()
const deleteProjectRecord = vi.fn()
const getProject = vi.fn()
const listEpisodes = vi.fn()
const listProjects = vi.fn()
const migrateLegacyNovelDirectoryRecord = vi.fn()
const repairProjectIssuesRecord = vi.fn()
const syncEpisodeStatus = vi.fn()
const syncSingleEpisodeStatus = vi.fn()

vi.mock('../db/queries', () => ({
  createProject: createProjectRecord,
  deleteProject: deleteProjectRecord,
  getProject,
  listEpisodes,
  listProjects,
  migrateLegacyNovelDirectory: migrateLegacyNovelDirectoryRecord,
  repairProjectIssues: repairProjectIssuesRecord,
  syncEpisodeStatus,
  syncSingleEpisodeStatus
}))

describe('project-service', async () => {
  const service = await import('./project-service')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('在 projectId 和 projectPath 都缺失时返回 null', () => {
    expect(service.findRegisteredProject({})).toBeNull()
    expect(getProject).not.toHaveBeenCalled()
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('按 projectId 优先解析已注册项目', () => {
    getProject.mockReturnValue({
      id: 'project-1',
      projectPath: '/tmp/by-id',
      config: { projectName: '项目 A' }
    })
    listProjects.mockReturnValue([
      {
        id: 'project-2',
        projectPath: '/tmp/by-path',
        config: { projectName: '项目 B' }
      }
    ])

    const result = service.findRegisteredProject({
      projectId: 'project-1',
      projectPath: '/tmp/by-path'
    })

    expect(getProject).toHaveBeenCalledWith('project-1')
    expect(listProjects).not.toHaveBeenCalled()
    expect(result).toEqual({
      id: 'project-1',
      projectPath: '/tmp/by-id',
      config: { projectName: '项目 A' }
    })
  })

  it('会按 projectPath 回退解析项目配置', () => {
    listProjects.mockReturnValue([
      {
        id: 'project-2',
        projectPath: '/tmp/by-path',
        config: {
          projectName: '项目 B',
          totalEpisodes: 3
        }
      }
    ])

    const result = service.resolveProjectConfig({
      projectPath: '/tmp/by-path'
    })

    expect(result).toEqual({
      projectName: '项目 B',
      totalEpisodes: 3
    })
  })

  it('getProjectByPath 在未匹配到项目时返回 undefined', () => {
    listProjects.mockReturnValue([
      {
        id: 'project-2',
        projectPath: '/tmp/other',
        config: { projectName: '项目 B' }
      }
    ])

    expect(service.getProjectByPath('/tmp/missing')).toBeUndefined()
  })

  it('createProject 会透传参数到底层仓储', async () => {
    const payload = {
      name: '项目 A',
      visualStyle: '现实',
      targetMedium: '短剧',
      projectPath: '/tmp/project-a',
      totalEpisodes: 12,
      config: { projectName: '项目 A', totalEpisodes: 12 }
    }
    createProjectRecord.mockResolvedValue({
      id: 'project-1',
      ...payload
    })

    const result = await service.createProject(payload)

    expect(createProjectRecord).toHaveBeenCalledWith(payload)
    expect(result).toEqual({
      id: 'project-1',
      ...payload
    })
  })

  it('deleteProject 会透传 id 到底层仓储', () => {
    service.deleteProject('project-1')
    expect(deleteProjectRecord).toHaveBeenCalledWith('project-1')
  })

  it('listProjectEpisodes 会返回底层仓储结果', () => {
    listEpisodes.mockReturnValue([
      { id: 'episode-1', episodeNumber: 1 },
      { id: 'episode-2', episodeNumber: 2 }
    ])

    const result = service.listProjectEpisodes('project-1')

    expect(listEpisodes).toHaveBeenCalledWith('project-1')
    expect(result).toEqual([
      { id: 'episode-1', episodeNumber: 1 },
      { id: 'episode-2', episodeNumber: 2 }
    ])
  })

  it('syncRegisteredProjectStatus 会使用结构化参数调用整项目同步', async () => {
    syncEpisodeStatus.mockResolvedValue([{ id: 'episode-1', episodeNumber: 1 }])

    const result = await service.syncRegisteredProjectStatus({
      projectId: 'project-1',
      projectPath: '/tmp/project'
    })

    expect(syncEpisodeStatus).toHaveBeenCalledWith('project-1', '/tmp/project')
    expect(result).toEqual([{ id: 'episode-1', episodeNumber: 1 }])
  })

  it('同步单集状态时会使用结构化参数转发到底层仓储', async () => {
    syncSingleEpisodeStatus.mockResolvedValue({
      id: 'episode-1',
      episodeNumber: 1
    })

    const result = await service.syncRegisteredProjectEpisodeStatus({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 1
    })

    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(
      'project-1',
      '/tmp/project',
      1
    )
    expect(result).toEqual({
      id: 'episode-1',
      episodeNumber: 1
    })
  })

  it('migrateLegacyNovelDirectory 会调用底层迁移实现', async () => {
    migrateLegacyNovelDirectoryRecord.mockResolvedValue({
      moved: true
    })

    const result = await service.migrateLegacyNovelDirectory('/tmp/project')

    expect(migrateLegacyNovelDirectoryRecord).toHaveBeenCalledWith(
      '/tmp/project'
    )
    expect(result).toEqual({ moved: true })
  })

  it('repairProjectIssues 会透传修复参数', async () => {
    const params = {
      projectPath: '/tmp/project',
      issueType: 'missing_source' as const
    }
    repairProjectIssuesRecord.mockResolvedValue({
      repaired: true
    })

    const result = await service.repairProjectIssues(params)

    expect(repairProjectIssuesRecord).toHaveBeenCalledWith(params)
    expect(result).toEqual({ repaired: true })
  })
})
