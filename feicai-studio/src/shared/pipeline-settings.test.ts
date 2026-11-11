import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PIPELINE_SETTINGS,
  mergePipelineSettings,
  parsePipelineSettings,
  parsePipelineSettingsPatch
} from './pipeline-settings'

describe('pipeline settings contract', () => {
  it('retains historical defaults and canonical ordering without mutating inputs', () => {
    expect(parsePipelineSettings()).toEqual({
      maxRetries: 3,
      passScore: 7,
      llmTimeoutSec: 90,
      durationMin: 90,
      durationMax: 120,
      singlePromptMax: 10,
      scriptWordCountMin: 1500,
      scriptWordCountMax: 2000
    })
    const reversed = Object.fromEntries(
      Object.entries(DEFAULT_PIPELINE_SETTINGS).reverse()
    )
    expect(JSON.stringify(parsePipelineSettings(reversed))).toBe(
      JSON.stringify(DEFAULT_PIPELINE_SETTINGS)
    )
    expect(parsePipelineSettings({})).toEqual(DEFAULT_PIPELINE_SETTINGS)
    const partial = Object.freeze({ passScore: 8.5 })
    expect(parsePipelineSettings(partial).passScore).toBe(8.5)
    expect(partial).toEqual({ passScore: 8.5 })
  })
  it.each([
    null,
    [],
    false,
    1,
    '7',
    { surprise: 1 },
    { passScore: undefined },
    { passScore: '7' },
    { passScore: NaN },
    { passScore: Infinity },
    { passScore: -1 },
    { passScore: 10.1 },
    { maxRetries: -1 },
    { maxRetries: 0.5 },
    { maxRetries: Number.MAX_SAFE_INTEGER + 1 },
    { llmTimeoutSec: 0 },
    { llmTimeoutSec: 2147483.648 },
    { durationMin: 0 },
    { durationMax: -1 },
    { singlePromptMax: 0 },
    { scriptWordCountMin: 0 },
    { scriptWordCountMax: 2.5 },
    { durationMin: 121 },
    { scriptWordCountMin: 2001 }
  ])('rejects invalid configuration %j', (input) => {
    expect(() => parsePipelineSettings(input)).toThrow()
  })
  it('accepts proven numeric domains, including fractional seconds and values beyond old UI caps', () => {
    expect(
      parsePipelineSettings({
        maxRetries: 0,
        passScore: 0,
        durationMin: 0.5,
        durationMax: 9999,
        singlePromptMax: 2.5,
        llmTimeoutSec: 0.25,
        scriptWordCountMax: 20000
      })
    ).toMatchObject({ maxRetries: 0, passScore: 0, singlePromptMax: 2.5 })
    expect(
      parsePipelineSettings({
        maxRetries: 20,
        passScore: 10,
        llmTimeoutSec: 2147483.647
      })
    ).toMatchObject({ maxRetries: 20 })
    expect(
      parsePipelineSettings({ llmTimeoutSec: 2147483.647 }).llmTimeoutSec * 1000
    ).toBe(2147483647)
    expect(
      mergePipelineSettings({ maxRetries: -1 }, { maxRetries: 0 }).maxRetries
    ).toBe(0)
    expect(() =>
      mergePipelineSettings({ maxRetries: -1 }, { passScore: 8 })
    ).toThrow()
  })
  it('validates patches against existing effective values, not premature defaults', () => {
    expect(parsePipelineSettingsPatch({ durationMin: 200 })).toEqual({
      durationMin: 200
    })
    expect(
      mergePipelineSettings(
        { durationMax: 300, passScore: 9 },
        { durationMin: 200 }
      )
    ).toMatchObject({ durationMin: 200, durationMax: 300, passScore: 9 })
    expect(() =>
      mergePipelineSettings({ durationMin: 100 }, { durationMax: 99 })
    ).toThrow('不能大于')
    expect(mergePipelineSettings({ passScore: 9 }, {})).toEqual(
      mergePipelineSettings({ passScore: 9 }, undefined)
    )
  })
})
