import {
  PIPELINE_SETTING_KEYS,
  parsePipelineSettings,
  parsePipelineSettingsPatch,
  type PipelineSettingKey
} from './pipeline-settings'
import type { PipelineSettings, ProjectEntryStage } from './types'

export const SKILL_PACKAGE_SCHEMA_VERSION = 1 as const
export const SKILL_STAGES = [
  'producer',
  'story',
  'story_review',
  'script',
  'script_review',
  'director',
  'director_review',
  'character',
  'art',
  'art_review',
  'storyboard',
  'storyboard_review',
  'compliance_review'
] as const
export type SkillStage = (typeof SKILL_STAGES)[number]
export type SkillResourceKind =
  | 'prompt'
  | 'methodology'
  | 'template'
  | 'example'
  | 'guide'
  | 'schema'
  | 'rules'
  | 'support'

export interface SkillResource {
  resourceId: string
  /** POSIX path relative to the package root. Project packages cannot use '..'. */
  path: string
  kind: SkillResourceKind
}

/** Declarative text/JSON only. References are resourceIds, never executable modules. */
export interface SkillPackageDefinition {
  schemaVersion: typeof SKILL_PACKAGE_SCHEMA_VERSION
  skillId: string
  version: string
  entrypoints: Array<{
    stage: SkillStage
    entries: ProjectEntryStage[]
    promptRef: string
  }>
  resources: SkillResource[]
  requiredInputs: string[]
  inputSchemaRef?: string
  outputSchemaRef?: string
  ruleProfileRef?: string
  /** Existing pipeline-settings contract is the sole parameter/default authority. */
  parameterContract: 'pipeline-settings/v1'
  allowedOverrides: PipelineSettingKey[]
  /** Requirements only: these declarations never grant tool permissions. */
  toolRequirements: Array<{ toolId: string; version: string; purpose: string }>
  modelCapabilities: string[]
}

export interface SkillPackageManifest extends SkillPackageDefinition {
  /** sha256 of the canonical definition and every captured resource's exact bytes. */
  contentHash: string
}
export interface SkillPackageReference {
  skillId: string
  version: string
  contentHash: string
}
export type SkillPackageSelection =
  | { source: 'builtin'; skillName: string; expected?: SkillPackageReference }
  | {
      source: 'project'
      /** Explicitly supplied package root; the loader does not discover project files. */
      packageDir: string
      expected: SkillPackageReference
    }

export interface SkillResourceSnapshot extends SkillResource {
  contentHash: string
  content: string
}
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T
export interface SkillPackageSnapshotData {
  manifest: SkillPackageManifest
  source: { kind: 'builtin' | 'project'; root: string }
  resources: SkillResourceSnapshot[]
  parameters: PipelineSettings
  parameterSources: Record<
    PipelineSettingKey,
    'default' | 'base' | 'project' | 'run'
  >
  /** Legacy resolved prompt retained for builtin provenance/compatibility only. */
  legacySkill?: import('./types').Skill
}
export type SkillPackageSnapshot = DeepReadonly<SkillPackageSnapshotData>

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(`${label} must be an object`)
  return input as Record<string, unknown>
}
function keys(input: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(input))
    if (!allowed.includes(key)) throw new Error(`Unknown Skill field: ${key}`)
}
function text(input: unknown, label: string): string {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0'))
    throw new Error(`${label} must be a nonempty string`)
  return input
}
function strings(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`)
  const result = input.map((item) => text(item, label))
  if (new Set(result).size !== result.length)
    throw new Error(`${label} contains duplicates`)
  return result
}
export function parseSkillContentHash(input: unknown): string {
  if (typeof input !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(input))
    throw new Error('Invalid Skill contentHash (expected sha256:hex)')
  return input
}

/** Strict schema: misspellings and future versions must not silently downgrade. */
export function parseSkillPackageManifest(
  input: unknown
): SkillPackageManifest {
  const value = object(input, 'Skill manifest')
  if (value.schemaVersion !== SKILL_PACKAGE_SCHEMA_VERSION)
    throw new Error(`Unsupported Skill schemaVersion: ${value.schemaVersion}`)
  keys(value, [
    'schemaVersion',
    'skillId',
    'version',
    'contentHash',
    'entrypoints',
    'resources',
    'requiredInputs',
    'inputSchemaRef',
    'outputSchemaRef',
    'ruleProfileRef',
    'parameterContract',
    'allowedOverrides',
    'toolRequirements',
    'modelCapabilities'
  ])
  if (value.parameterContract !== 'pipeline-settings/v1')
    throw new Error('Unknown Skill parameterContract')
  if (!Array.isArray(value.resources) || !value.resources.length)
    throw new Error('Skill resources must be a nonempty array')
  const kinds: SkillResourceKind[] = [
    'prompt',
    'methodology',
    'template',
    'example',
    'guide',
    'schema',
    'rules',
    'support'
  ]
  const resources = value.resources.map((input): SkillResource => {
    const resource = object(input, 'Skill resource')
    keys(resource, ['resourceId', 'path', 'kind'])
    const path = text(resource.path, 'Resource path')
    // One canonical path syntax on all platforms; reject drive/UNC paths too.
    if (
      path.includes('\\') ||
      path.includes(':') ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error(`Unsafe Skill resource path: ${path}`)
    if (!/\.(md|txt|json|ya?ml)$/.test(path))
      throw new Error(`Unsupported Skill text resource: ${path}`)
    if (!kinds.includes(resource.kind as SkillResourceKind))
      throw new Error(`Unknown Skill resource kind: ${resource.kind}`)
    return {
      resourceId: text(resource.resourceId, 'resourceId'),
      path,
      kind: resource.kind as SkillResourceKind
    }
  })
  for (const field of ['resourceId', 'path'] as const)
    if (
      new Set(resources.map((resource) => resource[field])).size !==
      resources.length
    )
      throw new Error(`Duplicate Skill resource ${field}`)
  const reference = (input: unknown, label: string): string => {
    const ref = text(input, label)
    if (!resources.some((resource) => resource.resourceId === ref))
      throw new Error(`Missing Skill resource reference: ${label}=${ref}`)
    return ref
  }
  if (!Array.isArray(value.entrypoints) || !value.entrypoints.length)
    throw new Error('Skill entrypoints must be a nonempty array')
  const entrypoints = value.entrypoints.map((input) => {
    const entry = object(input, 'Skill entrypoint')
    keys(entry, ['stage', 'entries', 'promptRef'])
    if (!SKILL_STAGES.includes(entry.stage as SkillStage))
      throw new Error(`Unknown Skill stage: ${entry.stage}`)
    const entries = strings(entry.entries, 'Skill entries')
    if (
      !entries.length ||
      entries.some((entry) => !['novel', 'story', 'script'].includes(entry))
    )
      throw new Error('Unknown or empty Skill entries')
    const promptRef = reference(entry.promptRef, 'promptRef')
    if (
      resources.find((resource) => resource.resourceId === promptRef)?.kind !==
      'prompt'
    )
      throw new Error('Skill promptRef must reference a prompt resource')
    return {
      stage: entry.stage as SkillStage,
      entries: entries as ProjectEntryStage[],
      promptRef
    }
  })
  if (
    new Set(entrypoints.map((entry) => entry.stage)).size !== entrypoints.length
  )
    throw new Error('Duplicate Skill entrypoint stage')
  const allowedOverrides = strings(value.allowedOverrides, 'allowedOverrides')
  if (
    allowedOverrides.some(
      (key) => !PIPELINE_SETTING_KEYS.includes(key as PipelineSettingKey)
    )
  )
    throw new Error('Unknown Skill allowedOverrides parameter')
  if (!Array.isArray(value.toolRequirements))
    throw new Error('toolRequirements must be an array')
  const toolRequirements = value.toolRequirements.map((input) => {
    const tool = object(input, 'Skill tool requirement')
    keys(tool, ['toolId', 'version', 'purpose'])
    return {
      toolId: text(tool.toolId, 'toolId'),
      version: text(tool.version, 'tool version'),
      purpose: text(tool.purpose, 'tool purpose')
    }
  })
  const result: SkillPackageManifest = {
    schemaVersion: 1,
    skillId: text(value.skillId, 'skillId'),
    version: text(value.version, 'version'),
    contentHash: parseSkillContentHash(value.contentHash),
    entrypoints,
    resources,
    requiredInputs: strings(value.requiredInputs, 'requiredInputs'),
    parameterContract: 'pipeline-settings/v1',
    allowedOverrides: allowedOverrides as PipelineSettingKey[],
    toolRequirements,
    modelCapabilities: strings(value.modelCapabilities, 'modelCapabilities')
  }
  for (const field of [
    'inputSchemaRef',
    'outputSchemaRef',
    'ruleProfileRef'
  ] as const) {
    if (value[field] === undefined) continue
    result[field] = reference(value[field], field)
    const expectedKind = field === 'ruleProfileRef' ? 'rules' : 'schema'
    if (
      resources.find((resource) => resource.resourceId === result[field])
        ?.kind !== expectedKind
    )
      throw new Error(
        `Skill ${field} must reference a ${expectedKind} resource`
      )
  }
  return result
}

/** Missing means inherit. Explicit null/undefined/arrays are invalid supplied values;
 * there is no clear operation for required numeric parameters. Lower layers must
 * already have passed their own application/system policy checks. */
export function resolveSkillParameters(
  allowed: readonly PipelineSettingKey[],
  base?: unknown,
  projectOverrides?: unknown,
  runOverrides?: unknown
): Pick<SkillPackageSnapshotData, 'parameters' | 'parameterSources'> {
  const basePatch = parsePipelineSettingsPatch(base)
  const parameterSources = Object.fromEntries(
    PIPELINE_SETTING_KEYS.map((key) => [
      key,
      Object.hasOwn(basePatch, key) ? 'base' : 'default'
    ])
  ) as SkillPackageSnapshotData['parameterSources']
  let parameters = parsePipelineSettings(basePatch)
  for (const [layer, input] of [
    ['project', projectOverrides],
    ['run', runOverrides]
  ] as const) {
    const patch = parsePipelineSettingsPatch(input)
    for (const key of Object.keys(patch) as PipelineSettingKey[]) {
      if (!allowed.includes(key))
        throw new Error(`Skill override not allowed: ${key}`)
      if (
        layer === 'run' &&
        key === 'passScore' &&
        patch[key]! < parameters.passScore
      )
        throw new Error('Run overrides cannot lower the review passScore')
      parameterSources[key] = layer
    }
    parameters = parsePipelineSettings({ ...parameters, ...patch })
  }
  return { parameters, parameterSources }
}
