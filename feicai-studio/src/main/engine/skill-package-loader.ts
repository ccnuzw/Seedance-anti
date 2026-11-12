import { createHash } from 'crypto'
import { basename, resolve } from 'path'
import {
  parseSkillContentHash,
  parseSkillPackageManifest,
  resolveSkillParameters,
  type DeepReadonly,
  type SkillPackageDefinition,
  type SkillPackageManifest,
  type SkillPackageReference,
  type SkillPackageSelection,
  type SkillPackageSnapshot,
  type SkillResource,
  type SkillResourceSnapshot,
  type SkillStage
} from '@shared/skill-package'
import { PIPELINE_SETTING_KEYS } from '@shared/pipeline-settings'
import type { ProjectEntryStage } from '@shared/types'
import { SkillLoader } from './skill-loader'
import { readSkillText } from './skill-package-files'

export const SKILL_PACKAGE_MANIFEST_FILE = 'skill-package.json'

const BUILTIN_STAGES: Record<string, SkillStage> = {
  'feicai-producer-skill': 'producer',
  'story-breakdown-skill': 'story',
  'story-breakdown-review-skill': 'story_review',
  'script-generation-skill': 'script',
  'script-review-skill': 'script_review',
  'director-skill': 'director',
  'script-analysis-review-skill': 'director_review',
  'character-design-skill': 'character',
  'art-design-skill': 'art',
  'art-direction-review-skill': 'art_review',
  'seedance-storyboard-skill': 'storyboard',
  'seedance-prompt-review-skill': 'storyboard_review',
  'compliance-review-skill': 'compliance_review'
}
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const hashText = (content: string): string =>
  `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort(compare)
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Ordering in manifest collections has no execution meaning. File bytes do:
 * line endings/BOM and dependency order inside Markdown remain significant.
 * Paths are logical package paths, so moving a package does not change identity. */
export function calculateSkillPackageHash(
  definition: DeepReadonly<SkillPackageDefinition>,
  captured: ReadonlyArray<{ path: string; content: string }>
): string {
  // Reconstructing via the shared decoder also excludes a supplied contentHash.
  const manifest = parseSkillPackageManifest({
    ...definition,
    contentHash: `sha256:${'0'.repeat(64)}`
  })
  const { contentHash: _claimedHash, ...data } = manifest
  const contents = new Map(
    captured.map((resource) => [resource.path, resource.content])
  )
  if (
    contents.size !== captured.length ||
    contents.size !== data.resources.length
  )
    throw new Error('Skill captured resource set does not match manifest')
  const resources = data.resources
    .map((resource) => {
      const content = contents.get(resource.path)
      if (content === undefined)
        throw new Error(`Missing Skill resource: ${resource.path}`)
      return { ...resource, contentHash: hashText(content) }
    })
    .sort((a, b) => compare(a.resourceId, b.resourceId))
  return hashText(
    canonicalJson({
      ...data,
      resources,
      entrypoints: data.entrypoints
        .map((entry) => ({
          ...entry,
          entries: [...entry.entries].sort(compare)
        }))
        .sort((a, b) => compare(a.stage, b.stage)),
      allowedOverrides: [...data.allowedOverrides].sort(compare),
      requiredInputs: [...data.requiredInputs].sort(compare),
      modelCapabilities: [...data.modelCapabilities].sort(compare),
      toolRequirements: [...data.toolRequirements].sort((a, b) =>
        compare(canonicalJson(a), canonicalJson(b))
      )
    })
  )
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}
function assertReference(
  manifest: SkillPackageManifest,
  expected: SkillPackageReference
): void {
  if (!expected || typeof expected !== 'object')
    throw new Error('A fixed Skill reference is required')
  parseSkillContentHash(expected.contentHash)
  for (const field of ['skillId', 'version', 'contentHash'] as const)
    if (expected[field] !== manifest[field])
      throw new Error(
        `Skill ${field} mismatch: expected ${expected[field]}, got ${manifest[field]}`
      )
}
function builtinKind(path: string): SkillResource['kind'] {
  if (basename(path) === 'SKILL.md') return 'prompt'
  if (path.includes('/templates/')) return 'template'
  if (path.includes('/examples/')) return 'example'
  if (/guide/i.test(basename(path))) return 'guide'
  return 'methodology'
}

export interface LoadSkillPackageOptions {
  /** Absent selection preserves the builtin profile; nothing is persisted. */
  selection?: SkillPackageSelection
  baseParameters?: unknown
  projectOverrides?: unknown
  runOverrides?: unknown
  stage?: SkillStage
  entry?: ProjectEntryStage
}

export class SkillPackageLoader {
  constructor(private readonly builtinSkillsDir: string) {}

  /** Each call reads fresh bytes and returns a detached, recursively frozen
   * snapshot. Holding a snapshot never holds a live file or mutable cache entry. */
  async load(
    fallbackSkillName: string,
    options: LoadSkillPackageOptions = {}
  ): Promise<SkillPackageSnapshot> {
    const selection = options.selection ?? {
      source: 'builtin',
      skillName: fallbackSkillName
    }
    let manifest: SkillPackageManifest
    let captured: Array<{ path: string; content: string }>
    let legacySkill: import('@shared/types').Skill | undefined
    let root: string
    if (selection.source === 'builtin') {
      if (!Object.hasOwn(BUILTIN_STAGES, selection.skillName))
        throw new Error(`Unknown builtin Skill: ${selection.skillName}`)
      root = resolve(this.builtinSkillsDir)
      const capture = await new SkillLoader(root).capture(selection.skillName)
      captured = capture.resources
      legacySkill = capture.skill
      const stage = BUILTIN_STAGES[selection.skillName]
      const definition: SkillPackageDefinition = {
        schemaVersion: 1,
        skillId: selection.skillName,
        version: 'builtin-compat.1',
        entrypoints: [
          {
            stage,
            entries:
              stage === 'story' || stage === 'story_review'
                ? ['novel']
                : stage === 'script'
                  ? ['novel', 'story']
                  : ['novel', 'story', 'script'],
            promptRef: `${selection.skillName}/SKILL.md`
          }
        ],
        resources: captured.map(({ path }) => ({
          resourceId: path,
          path,
          kind: builtinKind(path)
        })),
        requiredInputs: [],
        parameterContract: 'pipeline-settings/v1',
        allowedOverrides: [...PIPELINE_SETTING_KEYS],
        toolRequirements: [],
        modelCapabilities: ['text.generate']
      }
      manifest = parseSkillPackageManifest({
        ...definition,
        contentHash: calculateSkillPackageHash(definition, captured)
      })
      if (selection.expected) assertReference(manifest, selection.expected)
    } else if (selection.source === 'project') {
      if (typeof selection.packageDir !== 'string' || !selection.packageDir)
        throw new Error('An explicit Skill packageDir is required')
      root = resolve(selection.packageDir)
      // The selected package root is the authority boundary, including when the
      // user supplies a root symlink. No sibling packages/project files allowed.
      manifest = parseSkillPackageManifest(
        JSON.parse(
          await readSkillText(root, resolve(root, SKILL_PACKAGE_MANIFEST_FILE))
        )
      )
      captured = []
      for (const resource of manifest.resources) {
        if (resource.path === SKILL_PACKAGE_MANIFEST_FILE)
          throw new Error('Skill manifest cannot reference itself')
        captured.push({
          path: resource.path,
          content: await readSkillText(root, resolve(root, resource.path))
        })
      }
      const actualHash = calculateSkillPackageHash(manifest, captured)
      if (actualHash !== manifest.contentHash)
        throw new Error(`Skill contentHash mismatch: ${manifest.skillId}`)
      assertReference(manifest, selection.expected)
    } else {
      throw new Error('Unknown Skill package source')
    }
    if (
      options.stage !== undefined &&
      !manifest.entrypoints.some(
        (entry) =>
          entry.stage === options.stage &&
          (options.entry === undefined || entry.entries.includes(options.entry))
      )
    )
      throw new Error(
        `Skill is not applicable to stage/entry: ${options.stage}/${options.entry}`
      )
    if (
      options.stage === undefined &&
      options.entry !== undefined &&
      !manifest.entrypoints.some((entry) =>
        entry.entries.includes(options.entry!)
      )
    )
      throw new Error(`Skill is not applicable to entry: ${options.entry}`)
    const contents = new Map(
      captured.map((resource) => [resource.path, resource.content])
    )
    const resources: SkillResourceSnapshot[] = manifest.resources
      .map((resource) => {
        const content = contents.get(resource.path)!
        return { ...resource, content, contentHash: hashText(content) }
      })
      .sort((a, b) => compare(a.resourceId, b.resourceId))
    return freeze({
      manifest,
      source: { kind: selection.source, root },
      resources,
      ...resolveSkillParameters(
        manifest.allowedOverrides,
        options.baseParameters,
        options.projectOverrides,
        options.runOverrides
      ),
      ...(legacySkill ? { legacySkill } : {})
    })
  }
}
