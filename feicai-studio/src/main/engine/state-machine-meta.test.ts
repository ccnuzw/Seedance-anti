import { describe, expect, it } from 'vitest'
import {
  deriveEpisodeStatusFromStage,
  getPipelineStageName,
  PIPELINE_STAGE_ORDER,
  PIPELINE_STAGE_STATES,
  PIPELINE_TERMINAL_STATES
} from './state-machine-meta'

describe('state-machine-meta', () => {
  it('定义了稳定的阶段执行顺序', () => {
    expect(PIPELINE_STAGE_ORDER).toEqual(['director', 'art', 'storyboard'])
  })

  it('为每个阶段提供执行态、审核态和完成态', () => {
    expect(PIPELINE_STAGE_STATES.director).toEqual({
      executing: 'director_analyzing',
      reviewing: 'director_reviewing',
      done: 'director_done'
    })
    expect(PIPELINE_STAGE_STATES.storyboard.done).toBe('episode_complete')
  })

  it('提供稳定的阶段中文名称', () => {
    expect(getPipelineStageName('director')).toBe('导演分析')
    expect(getPipelineStageName('art')).toBe('服化道设计')
    expect(getPipelineStageName('storyboard')).toBe('分镜编写')
  })

  it('根据阶段派生 episode 状态', () => {
    expect(deriveEpisodeStatusFromStage('director')).toBe('director')
    expect(deriveEpisodeStatusFromStage('art')).toBe('art')
    expect(deriveEpisodeStatusFromStage('storyboard')).toBe('complete')
  })

  it('定义了统一终止态集合', () => {
    expect(PIPELINE_TERMINAL_STATES).toEqual([
      'idle',
      'episode_complete',
      'error',
      'paused'
    ])
  })
})
