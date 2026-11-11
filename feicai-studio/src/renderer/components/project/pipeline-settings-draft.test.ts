import { describe, expect, it } from 'vitest'
import {
  pipelineSettingsDraft,
  validatePipelineSettingsDraft
} from './pipeline-settings-draft'

describe('pipeline settings editing', () => {
  it('keeps empty, partial and invalid text intact while blocking saves with field errors', () => {
    for (const value of ['', '-', 'abc', 'Infinity', '-1', '1.5']) {
      const draft = { ...pipelineSettingsDraft(), maxRetries: value }
      expect(validatePipelineSettingsDraft(draft).issues).toContainEqual(
        expect.objectContaining({ field: 'maxRetries' })
      )
      expect(draft.maxRetries).toBe(value)
    }
  })
  it('shows both conflicting fields and accepts corrected values', () => {
    const draft = { ...pipelineSettingsDraft(), durationMin: '200' }
    expect(
      validatePipelineSettingsDraft(draft).issues.map((issue) => issue.field)
    ).toEqual(['durationMin', 'durationMax'])
    expect(
      validatePipelineSettingsDraft({ ...draft, durationMax: '200.5' }).settings
    ).toMatchObject({ durationMin: 200, durationMax: 200.5 })
  })
  it('exposes malformed stored settings instead of treating them as defaults or coercing strings', () => {
    for (const input of [null, [], { unexpected: 1 }, { passScore: '8' }]) {
      expect(
        validatePipelineSettingsDraft(pipelineSettingsDraft(input)).settings
      ).toBeUndefined()
      expect(pipelineSettingsDraft(input).configError).toBeTruthy()
    }
    const invalid = pipelineSettingsDraft({ passScore: 99 })
    expect(invalid.passScore).toBe('99')
    expect(validatePipelineSettingsDraft(invalid).issues[0].field).toBe(
      'passScore'
    )
    expect(
      validatePipelineSettingsDraft(pipelineSettingsDraft()).settings?.passScore
    ).toBe(7)
  })
})
