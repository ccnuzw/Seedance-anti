import type { PipelineSettings } from '@shared/types'
import {
  DEFAULT_PIPELINE_SETTINGS,
  PIPELINE_SETTING_KEYS,
  PipelineSettingsError,
  parsePipelineSettings,
  type PipelineSettingsIssue
} from '@shared/pipeline-settings'

export type PipelineSettingsDraft = Record<keyof PipelineSettings, string> & {
  configError?: string
}

export function pipelineSettingsDraft(input?: unknown): PipelineSettingsDraft {
  let configError: string | undefined
  try {
    parsePipelineSettings(input)
  } catch (error) {
    // Numeric errors remain editable per field; malformed structures/types must
    // be acknowledged by explicitly restoring defaults, never silently coerced.
    if (
      !(error instanceof PipelineSettingsError) ||
      error.issues.some((issue) => issue.field === '_config') ||
      (input &&
        typeof input === 'object' &&
        Object.values(input).some((value) => typeof value !== 'number'))
    )
      configError = error instanceof Error ? error.message : String(error)
  }
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  return {
    ...(Object.fromEntries(
      PIPELINE_SETTING_KEYS.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(source, key)
          ? String(source[key])
          : String(DEFAULT_PIPELINE_SETTINGS[key])
      ])
    ) as Record<keyof PipelineSettings, string>),
    ...(configError ? { configError } : {})
  }
}

export function validatePipelineSettingsDraft(draft: PipelineSettingsDraft): {
  settings?: PipelineSettings
  issues: PipelineSettingsIssue[]
} {
  if (draft.configError)
    return { issues: [{ field: '_config', message: draft.configError }] }
  try {
    const settings = parsePipelineSettings(
      Object.fromEntries(
        PIPELINE_SETTING_KEYS.map((key) => [
          key,
          draft[key].trim() === '' ? NaN : Number(draft[key])
        ])
      )
    )
    return { settings, issues: [] }
  } catch (error) {
    if (error instanceof PipelineSettingsError) return { issues: error.issues }
    throw error
  }
}
