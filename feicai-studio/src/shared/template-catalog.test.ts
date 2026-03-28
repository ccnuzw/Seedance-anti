import { describe, expect, it } from 'vitest'
import { buildProjectPresetConfig, resolveBuiltinExportProfile, resolveBuiltinProjectPreset } from './template-catalog'

describe('template-catalog', () => {
  it('builds persisted config from builtin project preset', () => {
    const preset = resolveBuiltinProjectPreset('preset:novel-stable')
    const config = buildProjectPresetConfig(preset)

    expect(config.templateProfileId).toBe('preset:novel-stable')
    expect(config.exportProfileId).toBe('export:delivery-bundle')
    expect(config.pipelineSettings?.maxRetries).toBe(3)
    expect(config.reviewPolicy?.qaMode).toBe('strict')
    expect(config.taskDefaults?.defaultBatchMode).toBe('independent')
  })

  it('returns empty config for missing preset', () => {
    expect(buildProjectPresetConfig(null)).toEqual({})
  })

  it('resolves builtin export profiles', () => {
    expect(resolveBuiltinExportProfile('export:review-pack')?.action).toBe('prompts')
  })
})
