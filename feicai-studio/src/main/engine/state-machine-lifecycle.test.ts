import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'fs/promises'
import {
  finalizeSingleStageRun,
  performSkipReview,
  preparePipelineStart
} from './state-machine-lifecycle'

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('# script')
}))

vi.mock('./project-state', () => ({
  ProjectStatePersistence: class MockPersistence {
    load = vi.fn().mockResolvedValue(undefined)
  }
}))

describe('state-machine-lifecycle', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset()
    vi.mocked(readFile).mockResolvedValue('# script')
  })

  it('preparePipelineStart 会初始化上下文并返回阶段序列', async () => {
    const onContextInitialized = vi.fn()
    const onProjectContextAssigned = vi.fn()
    const onProjectConfigAssigned = vi.fn()
    const onStatePersistenceAssigned = vi.fn()
    const onLog = vi.fn()
    const onStateChange = vi.fn()
    const onScriptPathAssigned = vi.fn()

    const result = await preparePipelineStart({
      params: {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 2
        },
        startStage: 'art',
        singleStage: true
      },
      llmConfigured: true,
      currentState: 'idle',
      onResetFlags: vi.fn(),
      onContextInitialized,
      onProjectContextAssigned,
      onProjectConfigAssigned,
      onStatePersistenceAssigned,
      onLog,
      onStateChange,
      onScriptPathAssigned,
      onError: vi.fn()
    })

    expect(onContextInitialized).toHaveBeenCalledTimes(1)
    expect(onProjectContextAssigned).toHaveBeenCalledTimes(1)
    expect(onProjectConfigAssigned).toHaveBeenCalledWith(null)
    expect(onStatePersistenceAssigned).toHaveBeenCalledTimes(1)
    expect(onScriptPathAssigned).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenCalledWith('script_done')
    expect(result).toEqual({
      stageSequence: ['art']
    })
  })

  it('preparePipelineStart 在缺少剧本时会返回 null 并调用错误回调', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
    const onError = vi.fn()

    const result = await preparePipelineStart({
      params: {
        projectId: 'project-1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectContext: {
          projectName: '项目',
          visualStyle: '现实',
          targetMedium: '短剧',
          episodeNumber: 2
        }
      },
      llmConfigured: true,
      currentState: 'idle',
      onResetFlags: vi.fn(),
      onContextInitialized: vi.fn(),
      onProjectContextAssigned: vi.fn(),
      onProjectConfigAssigned: vi.fn(),
      onStatePersistenceAssigned: vi.fn(),
      onLog: vi.fn(),
      onStateChange: vi.fn(),
      onScriptPathAssigned: vi.fn(),
      onError
    })

    expect(result).toBeNull()
    expect(onError).toHaveBeenCalledWith('加载剧本失败', expect.any(Error))
  })

  it('preparePipelineStart 在非终止态启动时会抛错', async () => {
    await expect(
      preparePipelineStart({
        params: {
          projectId: 'project-1',
          projectPath: '/tmp/project',
          episodeNum: 2,
          projectContext: {
            projectName: '项目',
            visualStyle: '现实',
            targetMedium: '短剧',
            episodeNumber: 2
          }
        },
        llmConfigured: true,
        currentState: 'director_analyzing',
        onResetFlags: vi.fn(),
        onContextInitialized: vi.fn(),
        onProjectContextAssigned: vi.fn(),
        onProjectConfigAssigned: vi.fn(),
        onStatePersistenceAssigned: vi.fn(),
        onLog: vi.fn(),
        onStateChange: vi.fn(),
        onScriptPathAssigned: vi.fn(),
        onError: vi.fn()
      })
    ).rejects.toThrow('无法在 director_analyzing 状态下启动流水线')
  })

  it('finalizeSingleStageRun 会在未停止时切换到阶段完成态', () => {
    const onLog = vi.fn()
    const onStateChange = vi.fn()

    finalizeSingleStageRun({
      startStage: 'storyboard',
      shouldStop: () => false,
      onLog,
      onStateChange
    })

    expect(onLog).toHaveBeenCalledWith(
      'info',
      'single_stage_done',
      '✅ 单阶段模式完成: 分镜编写'
    )
    expect(onStateChange).toHaveBeenCalledWith('episode_complete')
  })

  it('performSkipReview 会切换完成态并回写持久化', () => {
    const onLog = vi.fn()
    const onStateChange = vi.fn()
    const markStageSkipped = vi.fn().mockResolvedValue(undefined)
    const updateEpisodeStatus = vi.fn().mockResolvedValue(undefined)

    performSkipReview({
      stage: 'director',
      episodeNum: 3,
      statePersistence: {
        markStageSkipped,
        updateEpisodeStatus
      } as never,
      onLog,
      onStateChange
    })

    expect(onStateChange).toHaveBeenCalledWith('director_done')
    expect(markStageSkipped).toHaveBeenCalledWith(3, 'director')
    expect(updateEpisodeStatus).toHaveBeenCalledWith(3, 'director')
  })
})
