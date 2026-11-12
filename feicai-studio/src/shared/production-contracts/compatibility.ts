import {
  decodeProductionManifest,
  type ManifestDecodeOptions
} from './manifest'
import type { ProductionManifest } from './model'
import { relativePathSchema } from './schemas'
import {
  array,
  body,
  decode,
  id,
  object,
  problem,
  text,
  type ContractIssue,
  type DecodeResult,
  type Schema
} from './validation'

export type CompatibilityCheck =
  | { status: 'compatible'; manifest: ProductionManifest }
  | { status: 'unsupported' | 'invalid'; issues: ContractIssue[] }

export function checkProductionCompatibility(
  input: unknown,
  options: ManifestDecodeOptions = {}
): CompatibilityCheck {
  const result = decodeProductionManifest(input, options)
  return result.ok
    ? { status: 'compatible', manifest: result.value }
    : {
        status: result.issues.some((issue) => issue.code === 'unknown_schema')
          ? 'unsupported'
          : 'invalid',
        issues: result.issues
      }
}

export interface LegacyAssetPreview {
  type: 'character' | 'scene'
  sourceIndex: number // Coordinate in the supplied preview only, never an identity.
  legacyId: string // AssetManager currently generates temporary IDs on read.
  name: string
  promptText: string
  alias?: string
  referenceImagePath?: string // Display evidence only; not registered or read as a MediaObject.
  stableAssetId: null
  stableRevisionId: null
  status: 'needs-confirmation'
  reasons: ('unstable-identity' | 'unverified-media' | 'same-name')[]
}
export interface LegacyScriptPreview {
  relativePath: string
  markdown: string // Preserve the entire original; no invented scene boundaries or anchors.
  stableScriptId: null
  stableRevisionId: null
  status: 'needs-confirmation'
}
export interface LegacyProductionPreview {
  projectId: string
  status: 'needs-confirmation'
  scripts: LegacyScriptPreview[]
  assets: LegacyAssetPreview[]
  sameNameGroups: { name: string; assetIndexes: number[] }[]
}
interface LegacyAssetFields {
  id: string
  projectId: string
  name: string
  promptText: string
  alias?: string
  referenceImagePath?: string
}
// Preview only the verifiable fields already exposed by Character/Scene; other old metadata is not promoted.
const legacyAsset: Schema<LegacyAssetFields> = {
  read(value, path, issues) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problem(issues, path, 'schema', 'Expected legacy asset object')
      return undefined
    }
    const input = value as Record<string, unknown>
    const readField = <T>(key: string, schema: Schema<T>): T | undefined =>
      schema.read(
        Object.prototype.hasOwnProperty.call(input, key)
          ? input[key]
          : undefined,
        `${path}.${key}`,
        issues
      )
    const result = {
      id: readField('id', text),
      projectId: readField('projectId', body),
      name: readField('name', text),
      promptText: readField('promptText', body)
    }
    const alias =
      input.alias === undefined ? undefined : readField('alias', body)
    const referenceImagePath =
      input.referenceImagePath === undefined
        ? undefined
        : readField('referenceImagePath', text)
    if (
      result.id === undefined ||
      result.projectId === undefined ||
      result.name === undefined ||
      result.promptText === undefined
    )
      return undefined
    return {
      id: result.id,
      projectId: result.projectId,
      name: result.name,
      promptText: result.promptText,
      ...(alias === undefined ? {} : { alias }),
      ...(referenceImagePath === undefined ? {} : { referenceImagePath })
    }
  }
}
const legacyInput = object({
  projectId: id,
  scripts: array(object({ relativePath: relativePathSchema, markdown: body })),
  characters: array(legacyAsset),
  scenes: array(legacyAsset)
})

/** Explicit read-only adapter for supplied legacy values. No disk access, ID minting, matching/merging or migration. */
export function previewLegacyProduction(
  input: unknown
): DecodeResult<LegacyProductionPreview> {
  const result = decode(legacyInput, input)
  if (!result.ok) return result
  const issues: ContractIssue[] = []
  const request = result.value
  const assets: LegacyAssetPreview[] = []
  const append = (
    rows: LegacyAssetFields[],
    type: LegacyAssetPreview['type'],
    collection: string
  ): void => {
    rows.forEach((row, sourceIndex) => {
      if (row.projectId !== '' && row.projectId !== request.projectId)
        problem(
          issues,
          `$.${collection}[${sourceIndex}].projectId`,
          'project',
          'Legacy asset belongs to another project'
        )
      assets.push({
        type,
        sourceIndex,
        legacyId: row.id,
        name: row.name,
        promptText: row.promptText,
        ...(row.alias === undefined ? {} : { alias: row.alias }),
        ...(row.referenceImagePath === undefined
          ? {}
          : { referenceImagePath: row.referenceImagePath }),
        stableAssetId: null,
        stableRevisionId: null,
        status: 'needs-confirmation',
        reasons: [
          'unstable-identity',
          ...(row.referenceImagePath ? ['unverified-media' as const] : [])
        ]
      })
    })
  }
  append(request.characters, 'character', 'characters')
  append(request.scenes, 'scene', 'scenes')
  const names = new Map<string, number[]>()
  assets.forEach((asset, i) =>
    names.set(asset.name, [...(names.get(asset.name) ?? []), i])
  )
  const sameNameGroups: LegacyProductionPreview['sameNameGroups'] = []
  names.forEach((assetIndexes, name) => {
    if (assetIndexes.length < 2) return
    sameNameGroups.push({ name, assetIndexes })
    assetIndexes.forEach((i) => assets[i].reasons.push('same-name'))
  })
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    value: {
      projectId: request.projectId,
      status: 'needs-confirmation',
      scripts: request.scripts.map((script) => ({
        ...script,
        stableScriptId: null,
        stableRevisionId: null,
        status: 'needs-confirmation'
      })),
      assets,
      sameNameGroups
    }
  }
}
