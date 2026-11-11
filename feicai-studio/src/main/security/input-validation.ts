import {
  parsePipelineSettings,
  parsePipelineSettingsPatch
} from '@shared/pipeline-settings'
import { isAbsolute } from 'path'
import type { LLMConfig, ProjectConfig } from '@shared/types'
import { assertNonEmptyString } from './access-control'

export function assertRecord(
  value: unknown,
  label = '参数'
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}必须为对象`)
}

export function assertAllowedKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('包含不允许修改的参数')
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string')
    throw new Error(`${label}必须为字符串`)
}

function assertPlanningCount(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 10000
  )
    throw new Error('项目数量必须为0至10000的整数')
}

export function assertProjectConfig(
  value: unknown,
  patch = false
): asserts value is Partial<ProjectConfig> {
  assertRecord(value, '项目配置')
  assertAllowedKeys(value, [
    'projectName',
    'totalEpisodes',
    'visualStyle',
    'targetMedium',
    'chaptersPerEpisode',
    'createdAt',
    'workflowVersion',
    'entryStage',
    'workflowMode',
    'directories',
    'pipelineSettings'
  ])
  for (const key of ['projectName', 'visualStyle', 'targetMedium', 'createdAt'])
    optionalString(value[key], key)
  for (const key of ['totalEpisodes', 'chaptersPerEpisode'])
    if (value[key] !== undefined) assertPlanningCount(value[key])
  if (
    value.workflowVersion !== undefined &&
    value.workflowVersion !== 1 &&
    value.workflowVersion !== 2
  )
    throw new Error('无效工作流版本')
  if (
    value.entryStage !== undefined &&
    (typeof value.entryStage !== 'string' ||
      !['novel', 'story', 'script'].includes(value.entryStage))
  )
    throw new Error('无效起始阶段')
  if (
    value.workflowMode !== undefined &&
    (typeof value.workflowMode !== 'string' ||
      ![
        'legacy_shortdrama',
        'novel_to_shortdrama',
        'story_to_shortdrama',
        'script_to_shortdrama'
      ].includes(value.workflowMode))
  )
    throw new Error('无效工作流模式')
  if (value.directories !== undefined) {
    assertRecord(value.directories, '项目目录配置')
    assertAllowedKeys(value.directories, [
      'sourceDir',
      'storyDir',
      'scriptDir',
      'assetsDir',
      'outputsDir',
      'reviewsDir'
    ])
    for (const directory of Object.values(value.directories)) {
      assertNonEmptyString(directory, '目录')
      if (
        isAbsolute(directory) ||
        directory.startsWith('~') ||
        /^[a-zA-Z]:/.test(directory) ||
        directory.split(/[\\/]/).some((part) => part === '.' || part === '..')
      )
        throw new Error('项目目录必须为根内相对路径')
    }
  }
  if (value.pipelineSettings !== undefined) {
    if (patch) parsePipelineSettingsPatch(value.pipelineSettings)
    else parsePipelineSettings(value.pipelineSettings)
  }
}

export interface ProjectInput {
  name: string
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  config: Partial<ProjectConfig>
  sourceNovelFilePath?: string
}

export function parseProjectInput(value: unknown): ProjectInput {
  assertRecord(value)
  assertAllowedKeys(value, [
    'name',
    'visualStyle',
    'targetMedium',
    'projectPath',
    'totalEpisodes',
    'config',
    'sourceNovelFilePath'
  ])
  assertNonEmptyString(value.name, '项目名')
  assertNonEmptyString(value.visualStyle, '视觉风格')
  assertNonEmptyString(value.targetMedium, '目标媒介')
  assertNonEmptyString(value.projectPath, '项目路径')
  assertPlanningCount(value.totalEpisodes)
  assertProjectConfig(value.config, true)
  if (value.sourceNovelFilePath !== undefined)
    assertNonEmptyString(value.sourceNovelFilePath, '原文路径')
  return {
    name: value.name,
    visualStyle: value.visualStyle,
    targetMedium: value.targetMedium,
    projectPath: value.projectPath,
    totalEpisodes: value.totalEpisodes,
    config: value.config,
    sourceNovelFilePath: value.sourceNovelFilePath
  }
}

export function parseProjectUpdate(
  value: unknown
): Partial<Omit<ProjectInput, 'projectPath' | 'sourceNovelFilePath'>> {
  assertRecord(value)
  assertAllowedKeys(value, [
    'name',
    'visualStyle',
    'targetMedium',
    'totalEpisodes',
    'config'
  ])
  for (const key of ['name', 'visualStyle', 'targetMedium'])
    if (value[key] !== undefined) assertNonEmptyString(value[key], key)
  if (value.totalEpisodes !== undefined)
    assertPlanningCount(value.totalEpisodes)
  if (value.config !== undefined) assertProjectConfig(value.config, true)
  // All allowed fields were checked above; no identity/path fields survive.
  return value as Partial<
    Omit<ProjectInput, 'projectPath' | 'sourceNovelFilePath'>
  >
}

export function assertLLMConfig(
  value: unknown,
  partial = false
): asserts value is LLMConfig {
  assertRecord(value, '模型配置')
  assertAllowedKeys(value, [
    'id',
    'name',
    'category',
    'provider',
    'baseUrl',
    'apiKey',
    'hasStoredApiKey',
    'apiKeyMasked',
    'model',
    'wireApi',
    'reasoningEffort',
    'imageSize',
    'imageQuality',
    'imageOutputFormat',
    'imageBackground',
    'maxTokens',
    'temperature',
    'isDefault'
  ])
  for (const key of ['id', 'name', 'baseUrl', 'model']) {
    if (value[key] !== undefined || (!partial && key !== 'id'))
      assertNonEmptyString(value[key], key)
  }
  for (const key of ['apiKey', 'apiKeyMasked']) optionalString(value[key], key)
  if (!partial && typeof value.apiKey !== 'string')
    throw new Error('apiKey必须为字符串')
  const enums: Record<string, readonly string[]> = {
    category: ['llm', 'image', 'video'],
    provider: ['google', 'anthropic', 'openai', 'openai-compatible'],
    wireApi: ['chat-completions', 'responses'],
    reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh'],
    imageSize: ['auto', '1024x1024', '1024x1536', '1536x1024'],
    imageQuality: ['auto', 'low', 'medium', 'high'],
    imageOutputFormat: ['png', 'jpeg', 'webp'],
    imageBackground: ['auto', 'transparent', 'opaque']
  }
  for (const [key, choices] of Object.entries(enums)) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' ||
        !choices.includes(value[key] as string))
    )
      throw new Error(`${key}无效`)
  }
  if (
    !partial &&
    (value.category === undefined || value.provider === undefined)
  )
    throw new Error('缺少模型类型')
  for (const key of ['maxTokens', 'temperature']) {
    if (value[key] !== undefined || !partial) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
        throw new Error(`${key}必须为有限数值`)
    }
  }
  for (const key of ['isDefault', 'hasStoredApiKey'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error(`${key}必须为布尔值`)
}
