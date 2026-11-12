import { resolveProjectLayout } from '../path-resolver'
import type { ProductionManifest } from './model'
import type { ProductionLayout } from './paths'
import { manifestSchema } from './schemas'
import { adoptionSlotKey, validateManifestRelations } from './relations'
import { decode, type ContractIssue, type DecodeResult } from './validation'

export interface ManifestDecodeOptions {
  layout?: ProductionLayout
}

/** Decodes detached data only; never reads files, writes, verifies bytes or runs a migration. */
export function decodeProductionManifest(
  input: unknown,
  options: ManifestDecodeOptions = {}
): DecodeResult<ProductionManifest> {
  if (
    input !== null &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    input.schemaVersion !== 1
  ) {
    return {
      ok: false,
      issues: [
        {
          path: '$.schemaVersion',
          code: 'unknown_schema',
          message:
            'Unsupported production manifest schema; refuse read/write interpretation'
        }
      ]
    }
  }
  const decoded = decode(manifestSchema, input)
  if (!decoded.ok) return decoded
  const issues = validateManifestRelations(
    decoded.value,
    options.layout ?? resolveProjectLayout()
  )
  return issues.length ? { ok: false, issues } : decoded
}

export function parseProductionManifest(
  json: string,
  options: ManifestDecodeOptions = {}
): DecodeResult<ProductionManifest> {
  let input: unknown
  try {
    input = JSON.parse(json)
  } catch {
    return {
      ok: false,
      issues: [{ path: '$', code: 'schema', message: 'Invalid manifest JSON' }]
    }
  }
  return decodeProductionManifest(input, options)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** T03 must use this before committing an update: structural validity alone cannot prove immutability.
 * Retains all revision, media, binding, review and adoption facts. Restoration appends a new adoption.
 * Only asset display name/aliases and pending candidate technical status may change in place.
 */
export function decodeProductionManifestUpdate(
  previous: unknown,
  next: unknown,
  options: ManifestDecodeOptions = {}
): DecodeResult<ProductionManifest> {
  const before = decodeProductionManifest(previous, options)
  if (!before.ok)
    return {
      ok: false,
      issues: before.issues.map((issue) => ({
        ...issue,
        path: issue.path.replace(/^\$/, '$previous')
      }))
    }
  const after = decodeProductionManifest(next, options)
  if (!after.ok) return after
  const a = before.value,
    b = after.value
  const issues: ContractIssue[] = []
  const fail = (path: string, message: string): void => {
    issues.push({ path, code: 'history', message })
  }
  if (a.projectId !== b.projectId)
    fail('$.projectId', 'Cannot change manifest project ownership')
  function retain<T>(
    oldRows: T[],
    newRows: T[],
    key: (r: T) => string,
    collection: string,
    comparable: (r: T) => unknown = (r) => r
  ): void {
    const updated = new Map(newRows.map((r, i) => [key(r), { row: r, i }]))
    oldRows.forEach((row) => {
      const entry = updated.get(key(row))
      if (!entry)
        fail(
          `$.${collection}`,
          `Historical object ${key(row)} must be retained`
        )
      else if (canonical(comparable(row)) !== canonical(comparable(entry.row)))
        fail(
          `$.${collection}[${entry.i}]`,
          `Immutable facts changed for ${key(row)}`
        )
    })
  }
  retain(
    a.scriptRevisions,
    b.scriptRevisions,
    (r) => r.revisionId,
    'scriptRevisions'
  )
  retain(
    a.scenes,
    b.scenes,
    (r) => JSON.stringify([r.scriptRevisionId, r.sceneId]),
    'scenes'
  )
  retain(a.shots, b.shots, (r) => r.shotRevisionId, 'shots')
  retain(
    a.assets,
    b.assets,
    (r) => r.assetId,
    'assets',
    (r) => ({
      projectId: r.projectId,
      assetId: r.assetId,
      type: r.type,
      sources: r.sources
    })
  )
  retain(
    a.assetRevisions,
    b.assetRevisions,
    (r) => r.assetRevisionId,
    'assetRevisions'
  )
  retain(
    a.appearances,
    b.appearances,
    (r) => r.appearanceRevisionId,
    'appearances'
  )
  retain(
    a.promptRevisions,
    b.promptRevisions,
    (r) => r.promptRevisionId,
    'promptRevisions'
  )
  retain(a.media, b.media, (r) => r.mediaId, 'media')
  retain(
    a.candidates,
    b.candidates,
    (r) => r.candidateId,
    'candidates',
    (r) => ({ ...r, technicalStatus: null })
  )
  a.candidates.forEach((r) => {
    const i = b.candidates.findIndex((n) => n.candidateId === r.candidateId)
    if (
      i >= 0 &&
      r.technicalStatus !== 'pending' &&
      b.candidates[i].technicalStatus !== r.technicalStatus
    )
      fail(
        `$.candidates[${i}].technicalStatus`,
        'Completed technical check is immutable'
      )
  })
  retain(a.bindings, b.bindings, (r) => r.bindingId, 'bindings')
  retain(a.reviews, b.reviews, (r) => r.reviewId, 'reviews')
  retain(a.adoptions, b.adoptions, (r) => r.adoptionId, 'adoptions')
  retain(a.cuts, b.cuts, (r) => r.cutRevisionId, 'cuts')
  // Existing slots can advance only through an appended adoption, including a rollback to old media.
  const newCurrent = new Map(
    b.currentAdoptionIds.map((v) => {
      const record = b.adoptions.find((r) => r.adoptionId === v)!
      return [adoptionSlotKey(record), record]
    })
  )
  a.currentAdoptionIds.forEach((v) => {
    const old = a.adoptions.find((r) => r.adoptionId === v)!
    const current = newCurrent.get(adoptionSlotKey(old))
    if (!current) {
      fail(
        '$.currentAdoptionIds',
        'Existing adoption slot must retain a current history record'
      )
      return
    }
    if (current.adoptionId === old.adoptionId) return
    const oldIds = new Set(a.adoptions.map((r) => r.adoptionId))
    if (oldIds.has(current.adoptionId))
      fail('$.currentAdoptionIds', 'Rollback must append an adoption record')
    let ancestor: typeof current | undefined = current
    while (ancestor && ancestor.adoptionId !== old.adoptionId)
      ancestor = b.adoptions.find(
        (r) => r.adoptionId === ancestor?.previousAdoptionId
      )
    if (!ancestor)
      fail(
        '$.currentAdoptionIds',
        'New current adoption must extend the previous current history'
      )
  })
  return issues.length ? { ok: false, issues } : after
}
