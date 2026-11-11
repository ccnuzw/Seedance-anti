import type { PipelineSettings } from './types'

/** The eight project settings only. UI hints and runtime parsing share this contract. */
export const PIPELINE_SETTING_FIELDS = {
  maxRetries: {
    label: '最大重试次数',
    unit: '次',
    defaultValue: 3,
    min: 0,
    integer: true,
    description: '审核不通过时的自动重试上限，0 表示不重试'
  },
  passScore: {
    label: '审核通过阈值',
    unit: '分',
    defaultValue: 7,
    min: 0,
    max: 10,
    integer: false,
    description: '评分须达到此值，且审核结论必须为 PASS'
  },
  llmTimeoutSec: {
    label: 'LLM 超时',
    unit: '秒',
    defaultValue: 90,
    min: 0,
    exclusiveMin: true,
    max: 2147483647 / 1000,
    integer: false,
    description: '无新数据超过此时间则中断'
  },
  durationMin: {
    label: '每集最短时长',
    unit: '秒',
    defaultValue: 90,
    min: 0,
    exclusiveMin: true,
    integer: false,
    description: '生成提示词的最短总时长约束'
  },
  durationMax: {
    label: '每集最长时长',
    unit: '秒',
    defaultValue: 120,
    min: 0,
    exclusiveMin: true,
    integer: false,
    description: '生成提示词的最长总时长约束'
  },
  singlePromptMax: {
    label: '单条提示词上限',
    unit: '秒',
    defaultValue: 10,
    min: 0,
    exclusiveMin: true,
    integer: false,
    description: '每条 Seedance 提示词的时长上限'
  },
  scriptWordCountMin: {
    label: '剧本最少字数',
    unit: '字',
    defaultValue: 1500,
    min: 1,
    integer: true,
    description: '单集剧本正文下限'
  },
  scriptWordCountMax: {
    label: '剧本最多字数',
    unit: '字',
    defaultValue: 2000,
    min: 1,
    integer: true,
    description: '单集剧本正文上限'
  }
} satisfies Record<
  keyof PipelineSettings,
  {
    label: string
    unit: string
    defaultValue: number
    min: number
    exclusiveMin?: boolean
    max?: number
    integer: boolean
    description: string
  }
>

export type PipelineSettingKey = keyof PipelineSettings
export const PIPELINE_SETTING_KEYS = Object.keys(
  PIPELINE_SETTING_FIELDS
) as PipelineSettingKey[]
export const DEFAULT_PIPELINE_SETTINGS: Readonly<PipelineSettings> =
  Object.freeze(
    Object.fromEntries(
      PIPELINE_SETTING_KEYS.map((key) => [
        key,
        PIPELINE_SETTING_FIELDS[key].defaultValue
      ])
    ) as unknown as PipelineSettings
  )
export interface PipelineSettingsIssue {
  field: PipelineSettingKey | '_config'
  message: string
}
export class PipelineSettingsError extends Error {
  constructor(public readonly issues: PipelineSettingsIssue[]) {
    super(issues.map((issue) => issue.message).join('；'))
    this.name = 'PipelineSettingsError'
  }
}

/** Validate supplied fields only: cross-field checks belong after merging a patch. */
export function parsePipelineSettingsPatch(
  input: unknown
): Partial<PipelineSettings> {
  if (input === undefined) return {}
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new PipelineSettingsError([
      { field: '_config', message: '流水线配置必须为对象' }
    ])
  const issues: PipelineSettingsIssue[] = []
  const result: Partial<PipelineSettings> = {}
  for (const key of Object.keys(input)) {
    if (!PIPELINE_SETTING_KEYS.includes(key as PipelineSettingKey))
      issues.push({ field: '_config', message: `未知流水线参数：${key}` })
  }
  for (const key of PIPELINE_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue
    const value = (input as Record<string, unknown>)[key]
    const field = PIPELINE_SETTING_FIELDS[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({
        field: key,
        message: `${field.label}必须为有限数字（${field.unit}）`
      })
    } else if (field.integer && !Number.isSafeInteger(value)) {
      issues.push({
        field: key,
        message: `${field.label}必须为安全整数（${field.unit}）`
      })
    } else if (
      value < field.min ||
      ('exclusiveMin' in field && value === field.min) ||
      ('max' in field && value > field.max)
    ) {
      issues.push({
        field: key,
        message: `${field.label}须${'exclusiveMin' in field ? `大于 ${field.min}${'max' in field ? ` 且不超过 ${field.max}` : ''}` : 'max' in field ? `在 ${field.min}–${field.max} 之间` : `至少为 ${field.min}`}（${field.unit}）`
      })
    } else result[key] = Object.is(value, -0) ? 0 : value
  }
  if (issues.length) throw new PipelineSettingsError(issues)
  return result
}

/** Returns effective values in the historical default key order for stable credentials. */
export function parsePipelineSettings(input?: unknown): PipelineSettings {
  const result = {
    ...DEFAULT_PIPELINE_SETTINGS,
    ...parsePipelineSettingsPatch(input)
  }
  const issues: PipelineSettingsIssue[] = []
  for (const [min, max] of [
    ['durationMin', 'durationMax'],
    ['scriptWordCountMin', 'scriptWordCountMax']
  ] as const) {
    if (result[min] > result[max]) {
      const message = `${PIPELINE_SETTING_FIELDS[min].label}不能大于${PIPELINE_SETTING_FIELDS[max].label}`
      issues.push({ field: min, message }, { field: max, message })
    }
  }
  if (issues.length) throw new PipelineSettingsError(issues)
  return result
}

export function mergePipelineSettings(
  base: unknown,
  patch: unknown
): PipelineSettings {
  if (
    base !== undefined &&
    (!base || typeof base !== 'object' || Array.isArray(base))
  )
    throw new PipelineSettingsError([
      { field: '_config', message: '流水线配置必须为对象' }
    ])
  // Validate the actual effective values, allowing an explicit patch to repair a bad field.
  return parsePipelineSettings({
    ...base,
    ...parsePipelineSettingsPatch(patch)
  })
}
