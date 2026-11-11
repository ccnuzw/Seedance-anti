import { describe, expect, it } from 'vitest'
import { assertProjectConfig, parseProjectUpdate } from './input-validation'

describe('pipeline configuration at IPC input', () => {
  it.each([
    { passScore: '7' },
    { llmTimeoutSec: 0 },
    { maxRetries: 1.5 },
    { hidden: 1 },
    { durationMin: Infinity },
    null
  ])('rejects malformed settings %j', (pipelineSettings) => {
    expect(() => assertProjectConfig({ pipelineSettings })).toThrow()
    expect(() => parseProjectUpdate({ config: { pipelineSettings } })).toThrow()
  })
  it('checks standalone partial config with defaults but defers patch relations until the actual base is known', () => {
    expect(() =>
      assertProjectConfig({ pipelineSettings: { durationMin: 200 } })
    ).toThrow('不能大于')
    expect(
      parseProjectUpdate({ config: { pipelineSettings: { durationMin: 200 } } })
    ).toEqual({ config: { pipelineSettings: { durationMin: 200 } } })
  })
})
