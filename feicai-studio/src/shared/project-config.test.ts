import { describe, expect, it } from 'vitest'
import { mergeProjectConfig, normalizeProjectConfig } from './project-config'

describe('project pipeline settings', () => {
  it('merges nested updates before checking effective ranges', () => {
    expect(
      mergeProjectConfig(
        { pipelineSettings: { durationMax: 300, passScore: 9 } },
        { pipelineSettings: { durationMin: 200 } }
      ).pipelineSettings
    ).toMatchObject({ durationMin: 200, durationMax: 300, passScore: 9 })
    expect(() =>
      mergeProjectConfig(
        { pipelineSettings: { durationMin: 100 } },
        { pipelineSettings: { durationMax: 99 } }
      )
    ).toThrow('不能大于')
  })
  it('preserves invalid stored values for diagnostics in project lists and repair UI without rewriting them', () => {
    const config = { pipelineSettings: { passScore: 99 } }
    expect(normalizeProjectConfig(config).pipelineSettings).toEqual(
      config.pipelineSettings
    )
    expect(config).toEqual({ pipelineSettings: { passScore: 99 } })
  })
})
