import { describe, expect, it, vi } from 'vitest'
import {
  performPause,
  performResume,
  shouldStopPipelineExecution
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
    ).toBe(false)

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

  it('pause/resume 会通过回调驱动等待门状态', () => {
    const onStateChange = vi.fn()
    const onLog = vi.fn()
    const onPausedStateSaved = vi.fn()
    const onPausedStateCleared = vi.fn()

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

    expect(onPausedStateSaved).toHaveBeenCalledWith('director_analyzing')
    expect(onStateChange).toHaveBeenCalledWith('paused')
    expect(onStateChange).toHaveBeenCalledWith('director_analyzing')
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
