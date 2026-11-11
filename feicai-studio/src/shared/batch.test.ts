import { describe, expect, it, vi } from 'vitest'
import type { PipelineStartResult as ServicePipelineStartResult } from './ipc-contracts'
import {
  buildBatchPipelineParams,
  resolveBatchExecutionEpisodes,
  isWorkflowBatchMode,
  isBatchRunSuccess,
  runBatchWorkflowMode,
  type BatchMode,
  type BatchWorkflowDeps,
  resolveBatchRunProgress
} from './batch'

describe('batch-runner', () => {
  it('会根据批量模式构造 pipeline 参数', () => {
    const full = buildBatchPipelineParams(
      {
        projectId: 'p1',
        projectPath: '/tmp/project',
        episodeNum: 1,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      'full'
    )

    const director = buildBatchPipelineParams(
      {
        projectId: 'p1',
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      'director'
    )

    expect(full.startStage).toBeUndefined()
    expect(full.singleStage).toBe(false)
    expect(director.startStage).toBe('director')
    expect(director.singleStage).toBe(true)
  })

  it('会识别 workflow 批量模式', () => {
    expect(isWorkflowBatchMode('preproduction')).toBe(true)
    expect(isWorkflowBatchMode('story_review')).toBe(true)
    expect(isWorkflowBatchMode('director')).toBe(false)
  })

  it('会按水位为自动模式选择执行目标', () => {
    expect(
      resolveBatchExecutionEpisodes({
        mode: 'smart_next',
        selectedEpisodes: [],
        allEpisodes: [1, 2, 3],
        waterline: {
          unusedEntries: 0,
          readyEpisodeNumbers: [],
          nextBatchNumber: 4,
          unprocessedChapterCount: 20,
          nextActionMode: 'breakdown'
        }
      })
    ).toEqual([4])

    expect(
      resolveBatchExecutionEpisodes({
        mode: 'script_until_empty',
        selectedEpisodes: [],
        allEpisodes: [1, 2, 3],
        waterline: {
          unusedEntries: 8,
          readyEpisodeNumbers: [2, 3],
          nextBatchNumber: 4,
          unprocessedChapterCount: 20,
          nextActionMode: 'script'
        }
      })
    ).toEqual([2, 3])
  })

  it('会区分全流程和单阶段的成功状态', () => {
    expect(
      isBatchRunSuccess({ success: true, state: 'episode_complete' }, 'full')
    ).toBe(true)
    expect(
      isBatchRunSuccess({ success: true, state: 'director_done' }, 'full')
    ).toBe(false)
    expect(
      isBatchRunSuccess({ success: true, state: 'director_done' }, 'director')
    ).toBe(true)
    expect(
      isBatchRunSuccess(
        { success: true, state: 'episode_complete' },
        'director'
      )
    ).toBe(false)
  })

  it.each<{
    mode: BatchMode
    result: ServicePipelineStartResult
    status: 'done' | 'error'
  }>([
    {
      mode: 'art',
      result: { success: true, state: 'art_done' },
      status: 'done'
    },
    {
      mode: 'full',
      result: { success: true, state: 'episode_complete' },
      status: 'done'
    },
    {
      mode: 'full',
      result: { success: true, state: 'director_done' },
      status: 'error'
    },
    {
      mode: 'storyboard',
      result: { success: true, state: 'paused' },
      status: 'error'
    },
    {
      mode: 'director',
      result: { success: true, state: 'idle' },
      status: 'error'
    },
    {
      mode: 'art',
      result: {
        success: false,
        state: 'art_done',
        error: 'generation rejected'
      },
      status: 'error'
    },
    {
      mode: 'full',
      result: { success: false, error: 'pipeline busy' },
      status: 'error'
    },
    {
      mode: 'full',
      result: { error: 'pipeline start rejected' },
      status: 'error'
    },
    {
      mode: 'full',
      result: { success: false, message: 'pipeline unavailable' },
      status: 'error'
    },
    {
      mode: 'full',
      result: { success: true },
      status: 'error'
    }
  ])('$mode 模式按终态和执行结果判定 $status', ({ mode, result, status }) => {
    const progress = resolveBatchRunProgress(result, mode, 12)

    expect(progress).toMatchObject({ status, elapsed: 12 })
    if (result.error) expect(progress.progress).toContain(result.error)
    if (result.message) expect(progress.progress).toContain(result.message)
  })

  it.each<BatchMode>(['story', 'story_review', 'script', 'script_review'])(
    '%s 批量模式保留成功与失败结果并正确更新任务状态',
    async (mode) => {
      for (const success of [true, false]) {
        const serviceResult = success
          ? { success: true }
          : { success: false, error: 'workflow interrupted' }
        const deps: BatchWorkflowDeps = {
          runStoryGeneration: vi.fn().mockResolvedValue(serviceResult),
          runStoryReview: vi.fn().mockResolvedValue(serviceResult),
          runScriptGeneration: vi.fn().mockResolvedValue(serviceResult),
          runScriptReview: vi.fn().mockResolvedValue(serviceResult)
        }
        const result = await runBatchWorkflowMode(
          mode,
          {
            projectPath: '/tmp/project',
            episodeNum: 1,
            projectName: '项目',
            visualStyle: '现实',
            targetMedium: '短剧'
          },
          deps
        )
        const progress = resolveBatchRunProgress(result, mode, 31)

        expect(result).toMatchObject({
          success,
          stage: mode,
          result: serviceResult
        })
        expect(progress).toMatchObject({
          status: success ? 'done' : 'error',
          elapsed: 31
        })
        if (!success) expect(progress.progress).toContain(serviceResult.error)
      }
    }
  )

  it('preproduction 有剧情库存时会直接生成剧本', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(1)
    expect(deps.runScriptReview).toHaveBeenCalledTimes(1)
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
  })

  it('preproduction 缺少未用剧情点时会先补剧情库存', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '冲突不足' }
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptGeneration: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: '缺少当前集未用剧情点，请先完成剧情库存拆解'
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(2)
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '冲突不足' })
    )
    expect(deps.runStoryReview).toHaveBeenCalledTimes(2)
    expect(deps.runScriptReview).toHaveBeenCalledTimes(1)
  })

  it('preproduction 会按 maxRetries 多轮修复剧情拆解审核失败', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '冲突不足' }
        })
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '钩子不足' }
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptGeneration: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          error: '缺少当前集未用剧情点，请先完成剧情库存拆解'
        })
        .mockResolvedValueOnce({ success: true }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        maxRetries: 2
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runStoryGeneration).toHaveBeenCalledTimes(3)
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '冲突不足' })
    )
    expect(deps.runStoryGeneration).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ reviewFeedback: '钩子不足' })
    )
    expect(deps.runStoryReview).toHaveBeenCalledTimes(3)
  })

  it('preproduction 会在剧本审核失败后带反馈重写并复审', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '对白拖沓' }
        })
        .mockResolvedValueOnce({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '对白拖沓' })
    )
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
    expect(deps.runScriptReview).toHaveBeenCalledTimes(2)
  })

  it('preproduction 会按 maxRetries 多轮修复剧本审核失败', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({ success: true }),
      runScriptReview: vi
        .fn()
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '对白拖沓' }
        })
        .mockResolvedValueOnce({
          success: false,
          review: { feedback: '动作不足' }
        })
        .mockResolvedValueOnce({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        maxRetries: 2
      },
      deps
    )

    expect(result.success).toBe(true)
    expect(deps.runScriptGeneration).toHaveBeenCalledTimes(3)
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reviewFeedback: '对白拖沓' })
    )
    expect(deps.runScriptGeneration).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ reviewFeedback: '动作不足' })
    )
    expect(deps.runScriptReview).toHaveBeenCalledTimes(3)
  })

  it('preproduction 遇到非库存错误时不会补剧情拆解', async () => {
    const deps = {
      runStoryGeneration: vi.fn().mockResolvedValue({ success: true }),
      runStoryReview: vi.fn().mockResolvedValue({ success: true }),
      runScriptGeneration: vi.fn().mockResolvedValue({
        success: false,
        error: '连接失败'
      }),
      runScriptReview: vi.fn().mockResolvedValue({ success: true })
    }

    const result = await runBatchWorkflowMode(
      'preproduction',
      {
        projectPath: '/tmp/project',
        episodeNum: 2,
        projectName: '项目',
        visualStyle: '现实',
        targetMedium: '短剧'
      },
      deps
    )

    expect(result).toMatchObject({
      success: false,
      stage: 'script',
      message: '连接失败'
    })
    expect(deps.runStoryGeneration).not.toHaveBeenCalled()
    expect(deps.runStoryReview).not.toHaveBeenCalled()
    expect(deps.runScriptReview).not.toHaveBeenCalled()
  })
})

it('分镜单阶段采用与主进程一致的episode_complete终态', () => {
  expect(
    isBatchRunSuccess(
      { success: true, state: 'episode_complete', stage: 'storyboard' },
      'storyboard'
    )
  ).toBe(true)
  expect(
    isBatchRunSuccess(
      { success: true, state: 'storyboard_done', stage: 'storyboard' },
      'storyboard'
    )
  ).toBe(false)
})
