import { describe, expect, it, vi } from 'vitest'
import type { PipelineState } from '@shared/types'
import {
  getRetryStageSequence,
  performAbort,
  performPause,
  performResume,
  shouldStopPipelineExecution,
  waitForTerminalState
} from './state-machine-controls'

describe('state-machine-controls', () => {
  it('根据上下文与 aborted 标志判断是否应停止执行', () => {
    expect(
      shouldStopPipelineExecution(
        {
          projectId: 'p1',
          projectPath: '/tmp',
          episodeNum: 1,
          currentStage: 'director',
          state: 'paused',
          retryCount: 0,
          reviews: [],
          logs: []
        },
        false
      )
    ).toBe(true)

    expect(
      shouldStopPipelineExecution(
        {
          projectId: 'p1',
          projectPath: '/tmp',
          episodeNum: 1,
          currentStage: 'director',
          state: 'director_analyzing',
          retryCount: 0,
          reviews: [],
          logs: []
        },
        false
      )
    ).toBe(false)
  })

  it('返回从目标阶段开始的重试阶段序列', () => {
    expect(getRetryStageSequence('director')).toEqual([
      'director',
      'art',
      'storyboard'
    ])
    expect(getRetryStageSequence('art')).toEqual(['art', 'storyboard'])
  })

  it('pause/resume/abort 会通过回调驱动控制流', () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onPausedStateSaved = vi.fn()
    const onPausedStateCleared = vi.fn()
    const onAborted = vi.fn()
    const onErrorCleared = vi.fn()

    performPause({
      currentState: 'director_analyzing',
      onPausedStateSaved,
      onStateChange,
      onLog
    })
    performResume({
      currentState: 'paused',
      pausedState: 'director_analyzing',
      onStateChange,
      onPausedStateCleared,
      onLog
    })
    performAbort({
      onAborted,
      onPausedStateCleared,
      onErrorCleared,
      onStateChange,
      onLog
    })

    expect(onPausedStateSaved).toHaveBeenCalledWith('director_analyzing')
    expect(onStateChange).toHaveBeenCalledWith('paused')
    expect(onStateChange).toHaveBeenCalledWith('director_analyzing')
    expect(onAborted).toHaveBeenCalledTimes(1)
    expect(onErrorCleared).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenCalledWith('idle')
  })

  it('waitForTerminalState 在状态切到终止态时 resolve', async () => {
    let listener: ((state: PipelineState) => void) | undefined
    const resultPromise = waitForTerminalState(
      {
        projectId: 'p1',
        projectPath: '/tmp',
        episodeNum: 1,
        currentStage: 'art',
        state: 'art_designing',
        retryCount: 0,
        reviews: [],
        logs: []
      },
      (cb) => {
        listener = cb
      },
      vi.fn()
    )

    listener?.('episode_complete')
    await expect(resultPromise).resolves.toEqual({
      state: 'episode_complete',
      stage: 'art'
    })
  })

  it('waitForTerminalState 在初始就是终止态时立即 resolve', async () => {
    await expect(
      waitForTerminalState(
        {
          projectId: 'p1',
          projectPath: '/tmp',
          episodeNum: 1,
          currentStage: 'storyboard',
          state: 'episode_complete',
          retryCount: 0,
          reviews: [],
          logs: []
        },
        vi.fn(),
        vi.fn()
      )
    ).resolves.toEqual({
      state: 'episode_complete',
      stage: 'storyboard'
    })
  })

  it('performResume 在没有 pausedState 时不做任何动作', () => {
    const onStateChange = vi.fn()
    const onPausedStateCleared = vi.fn()
    const onLog = vi.fn()

    performResume({
      currentState: 'paused',
      pausedState: null,
      onStateChange,
      onPausedStateCleared,
      onLog
    })

    expect(onStateChange).not.toHaveBeenCalled()
    expect(onPausedStateCleared).not.toHaveBeenCalled()
    expect(onLog).not.toHaveBeenCalled()
  })
})
