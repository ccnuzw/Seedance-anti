import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()
const getProjectByPath = vi.fn()

vi.mock('fs/promises', () => ({
  readFile
}))

vi.mock('./project-service', () => ({
  getProjectByPath
}))

describe('project-state-service', async () => {
  const service = await import('./project-state-service')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会根据项目配置解析自定义 pipeline state 路径', async () => {
    getProjectByPath.mockReturnValue({
      id: 'project-1',
      projectPath: '/tmp/project',
      config: {
        projectName: '项目',
        totalEpisodes: 2,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-07T00:00:00.000Z',
        directories: {
          outputsDir: 'custom-outputs'
        }
      }
    })
    readFile.mockResolvedValue('{"updatedAt":"2026-05-07T00:00:00.000Z"}')

    const result = await service.getProjectPipelineState('/tmp/project')

    expect(getProjectByPath).toHaveBeenCalledWith('/tmp/project')
    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project/custom-outputs/pipeline-state.json',
      'utf-8'
    )
    expect(result).toEqual({ updatedAt: '2026-05-07T00:00:00.000Z' })
  })

  it('读取失败时返回 null', async () => {
    getProjectByPath.mockReturnValue(undefined)
    readFile.mockRejectedValue(new Error('ENOENT'))

    await expect(
      service.getProjectPipelineState('/tmp/missing')
    ).resolves.toBeNull()
  })

  it('未注册项目时会回退默认 outputs 目录解析 pipeline state', async () => {
    getProjectByPath.mockReturnValue(undefined)
    readFile.mockResolvedValue(
      '{"projectId":"project-2","updatedAt":"2026-05-08T00:00:00.000Z","episodes":{}}'
    )

    const result = await service.getProjectPipelineState('/tmp/project-b')

    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project-b/outputs/pipeline-state.json',
      'utf-8'
    )
    expect(result).toEqual({
      projectId: 'project-2',
      updatedAt: '2026-05-08T00:00:00.000Z',
      episodes: {}
    })
  })

  it('JSON 解析失败时返回 null', async () => {
    getProjectByPath.mockReturnValue({
      id: 'project-1',
      projectPath: '/tmp/project',
      config: {
        projectName: '项目',
        totalEpisodes: 2,
        visualStyle: '现实',
        targetMedium: '短剧',
        createdAt: '2026-05-07T00:00:00.000Z'
      }
    })
    readFile.mockResolvedValue('not-json')

    await expect(
      service.getProjectPipelineState('/tmp/project')
    ).resolves.toBeNull()
  })
})
