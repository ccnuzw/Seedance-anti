import type {
  AdoptionRecord,
  MediaObject,
  MediaPurpose,
  Owned,
  ProductionManifest,
  VersionRef
} from './model'
import type { ProductionLayout } from './paths'
import { getProductionPaths, isWithinRelativeDirectory } from './paths'
import { type ContractIssue, problem } from './validation'

export function sameVersion(a: VersionRef, b: VersionRef): boolean {
  return (
    a.projectId === b.projectId &&
    a.kind === b.kind &&
    a.objectId === b.objectId &&
    a.revisionId === b.revisionId
  )
}
export function adoptionSlotKey(
  record: Pick<AdoptionRecord, 'target' | 'slotId'>
): string {
  const t = record.target
  return JSON.stringify([
    t.projectId,
    t.kind,
    t.objectId,
    t.revisionId,
    record.slotId
  ])
}
export function mediaSupportsPurpose(
  media: MediaObject,
  purpose: MediaPurpose
): boolean {
  return (
    media.kind ===
    (purpose === 'shot-video'
      ? 'video'
      : purpose === 'audio-reference'
        ? 'audio'
        : 'image')
  )
}

// Called only after structural decoding; all lookups remain project scoped, with no "latest" resolution.
export function validateManifestRelations(
  m: ProductionManifest,
  layout: ProductionLayout
): ContractIssue[] {
  const issues: ContractIssue[] = []
  const fail = (
    path: string,
    code: ContractIssue['code'],
    message: string
  ): void => problem(issues, path, code, message)
  function index<T extends Owned>(
    rows: T[],
    key: (row: T) => string,
    collection: string
  ): Map<string, T> {
    const result = new Map<string, T>()
    rows.forEach((row, i) => {
      const path = `$.${collection}[${i}]`
      if (row.projectId !== m.projectId)
        fail(
          `${path}.projectId`,
          'project',
          'Object belongs to another project'
        )
      const k = key(row)
      if (result.has(k)) fail(path, 'duplicate', `Duplicate identity ${k}`)
      result.set(k, row)
    })
    return result
  }
  const scripts = index(
    m.scriptRevisions,
    (r) => r.revisionId,
    'scriptRevisions'
  )
  const scenes = index(
    m.scenes,
    (r) => JSON.stringify([r.scriptRevisionId, r.sceneId]),
    'scenes'
  )
  const shots = index(m.shots, (r) => r.shotRevisionId, 'shots')
  const assets = index(m.assets, (r) => r.assetId, 'assets')
  const revisions = index(
    m.assetRevisions,
    (r) => r.assetRevisionId,
    'assetRevisions'
  )
  const appearances = index(
    m.appearances,
    (r) => r.appearanceRevisionId,
    'appearances'
  )
  const prompts = index(
    m.promptRevisions,
    (r) => r.promptRevisionId,
    'promptRevisions'
  )
  const media = index(m.media, (r) => r.mediaId, 'media')
  const candidates = index(m.candidates, (r) => r.candidateId, 'candidates')
  index(m.bindings, (r) => r.bindingId, 'bindings')
  const reviews = index(m.reviews, (r) => r.reviewId, 'reviews')
  const adoptions = index(m.adoptions, (r) => r.adoptionId, 'adoptions')
  const cuts = index(m.cuts, (r) => r.cutRevisionId, 'cuts')
  function lookup<T>(
    map: Map<string, T>,
    key: string,
    path: string
  ): T | undefined {
    const value = map.get(key)
    if (!value) fail(path, 'reference', `Unresolved reference ${key}`)
    return value
  }
  function ref(r: VersionRef, path: string): void {
    if (r.projectId !== m.projectId)
      fail(`${path}.projectId`, 'project', 'Cross-project reference')
    let actualId: string | undefined
    switch (r.kind) {
      case 'script':
        actualId = scripts.get(r.revisionId)?.scriptId
        break
      case 'scene':
        actualId = scenes.get(
          JSON.stringify([r.revisionId, r.objectId])
        )?.sceneId
        break
      case 'shot':
        actualId = shots.get(r.revisionId)?.shotId
        break
      case 'asset':
        actualId = revisions.get(r.revisionId)?.assetId
        break
      case 'appearance':
        actualId = appearances.get(r.revisionId)?.appearanceId
        break
      case 'prompt':
        actualId = prompts.get(r.revisionId)?.promptId
        break
      case 'cut':
        actualId = cuts.get(r.revisionId)?.cutId
        break
    }
    if (actualId === undefined)
      fail(`${path}.revisionId`, 'reference', 'Unknown object revision')
    else if (actualId !== r.objectId)
      fail(
        `${path}.objectId`,
        'version',
        'Revision belongs to another logical object'
      )
  }
  function parents<T extends { parentRevisionId: string | null }>(
    rows: T[],
    map: Map<string, T>,
    logical: (r: T) => string,
    revision: (r: T) => string,
    collection: string
  ): void {
    rows.forEach((row, i) => {
      const path = `$.${collection}[${i}]`
      if (logical(row) === revision(row))
        fail(path, 'version', 'Logical ID and revision ID must be distinct')
      const seen = new Set([revision(row)])
      let next = row.parentRevisionId
      while (next !== null) {
        if (seen.has(next)) {
          fail(
            `${path}.parentRevisionId`,
            'history',
            'Cyclic revision ancestry'
          )
          break
        }
        seen.add(next)
        const parent = lookup(map, next, `${path}.parentRevisionId`)
        if (!parent) break
        if (logical(parent) !== logical(row)) {
          fail(
            `${path}.parentRevisionId`,
            'version',
            'Parent belongs to another logical object'
          )
          break
        }
        next = parent.parentRevisionId
      }
    })
  }
  parents(
    m.scriptRevisions,
    scripts,
    (r) => r.scriptId,
    (r) => r.revisionId,
    'scriptRevisions'
  )
  parents(
    m.shots,
    shots,
    (r) => r.shotId,
    (r) => r.shotRevisionId,
    'shots'
  )
  parents(
    m.assetRevisions,
    revisions,
    (r) => r.assetId,
    (r) => r.assetRevisionId,
    'assetRevisions'
  )
  parents(
    m.appearances,
    appearances,
    (r) => r.appearanceId,
    (r) => r.appearanceRevisionId,
    'appearances'
  )
  parents(
    m.promptRevisions,
    prompts,
    (r) => r.promptId,
    (r) => r.promptRevisionId,
    'promptRevisions'
  )
  parents(
    m.cuts,
    cuts,
    (r) => r.cutId,
    (r) => r.cutRevisionId,
    'cuts'
  )
  function stableScope<T>(
    rows: T[],
    identity: (r: T) => string,
    scope: (r: T) => string,
    collection: string
  ): void {
    const owners = new Map<string, string>()
    rows.forEach((row, i) => {
      const owner = scope(row),
        key = identity(row)
      if (owners.has(key) && owners.get(key) !== owner)
        fail(
          `$.${collection}[${i}]`,
          'version',
          'Stable identity changed its owning script/episode'
        )
      owners.set(key, owner)
    })
  }
  stableScope(
    m.scriptRevisions,
    (r) => r.scriptId,
    (r) => String(r.episodeNumber),
    'scriptRevisions'
  )
  stableScope(
    m.scenes,
    (r) => r.sceneId,
    (r) => scripts.get(r.scriptRevisionId)?.scriptId ?? '',
    'scenes'
  )
  stableScope(
    m.shots,
    (r) => r.shotId,
    (r) => scripts.get(r.scriptRevisionId)?.scriptId ?? '',
    'shots'
  )
  stableScope(
    m.cuts,
    (r) => r.cutId,
    (r) => scripts.get(r.scriptRevisionId)?.scriptId ?? '',
    'cuts'
  )
  function unique(values: string[], path: string): void {
    const seen = new Set<string>()
    values.forEach((v, i) => {
      if (seen.has(v)) fail(`${path}[${i}]`, 'duplicate', 'Duplicate entry')
      seen.add(v)
    })
  }
  m.scenes.forEach((r, i) => {
    lookup(scripts, r.scriptRevisionId, `$.scenes[${i}].scriptRevisionId`)
    unique(r.plotPointIds, `$.scenes[${i}].plotPointIds`)
  })
  m.shots.forEach((r, i) => {
    lookup(scripts, r.scriptRevisionId, `$.shots[${i}].scriptRevisionId`)
    lookup(
      scenes,
      JSON.stringify([r.scriptRevisionId, r.sceneId]),
      `$.shots[${i}].sceneId`
    )
  })
  m.assetRevisions.forEach((r, i) =>
    lookup(assets, r.assetId, `$.assetRevisions[${i}].assetId`)
  )
  m.appearances.forEach((r, i) => {
    function typedAsset(revisionId: string, type: string, path: string): void {
      const revision = lookup(revisions, revisionId, path)
      if (revision && assets.get(revision.assetId)?.type !== type)
        fail(path, 'version', `Expected ${type} asset revision`)
    }
    typedAsset(
      r.characterRevisionId,
      'character',
      `$.appearances[${i}].characterRevisionId`
    )
    r.costumeRevisionIds.forEach((v, j) =>
      typedAsset(v, 'costume', `$.appearances[${i}].costumeRevisionIds[${j}]`)
    )
    r.makeupRevisionIds.forEach((v, j) =>
      typedAsset(v, 'makeup', `$.appearances[${i}].makeupRevisionIds[${j}]`)
    )
    unique(r.costumeRevisionIds, `$.appearances[${i}].costumeRevisionIds`)
    unique(r.makeupRevisionIds, `$.appearances[${i}].makeupRevisionIds`)
  })
  m.promptRevisions.forEach((r, i) => {
    ref(r.target, `$.promptRevisions[${i}].target`)
    r.inputs.forEach((v, j) => ref(v, `$.promptRevisions[${i}].inputs[${j}]`))
    r.mediaIds.forEach((v, j) =>
      lookup(media, v, `$.promptRevisions[${i}].mediaIds[${j}]`)
    )
    unique(r.mediaIds, `$.promptRevisions[${i}].mediaIds`)
  })
  let directories: ReturnType<typeof getProductionPaths> | undefined
  try {
    directories = getProductionPaths(layout)
  } catch {
    fail('$layout', 'path', 'Invalid production layout')
  }
  const paths = new Map<string, string>()
  const extensions: Record<MediaObject['mimeType'], string[]> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
    'video/mp4': ['mp4'],
    'video/webm': ['webm'],
    'video/quicktime': ['mov'],
    'audio/wav': ['wav'],
    'audio/mpeg': ['mp3'],
    'audio/mp4': ['m4a'],
    'audio/ogg': ['ogg']
  }
  m.media.forEach((r, i) => {
    const path = `$.media[${i}].relativePath`
    if (
      directories &&
      ![directories.assetMedia, directories.outputMedia].some((dir) =>
        isWithinRelativeDirectory(r.relativePath, dir)
      )
    )
      fail(
        path,
        'path',
        'Media must be inside the configured assetsDir/media or outputsDir/media'
      )
    const extension = r.relativePath.split('.').at(-1)?.toLowerCase() ?? ''
    if (!extensions[r.mimeType].includes(extension))
      fail(path, 'path', 'File extension does not match MIME type')
    const folded = r.relativePath.toLowerCase()
    const signature = JSON.stringify([
      r.contentHash,
      r.byteLength,
      r.kind,
      r.mimeType,
      'width' in r ? r.width : null,
      'height' in r ? r.height : null,
      'durationSeconds' in r ? r.durationSeconds : null,
      'hasAudio' in r ? r.hasAudio : null,
      'channels' in r ? r.channels : null,
      'sampleRate' in r ? r.sampleRate : null
    ])
    if (paths.has(folded) && paths.get(folded) !== signature)
      fail(path, 'path', 'Conflicting media facts for the same portable path')
    paths.set(folded, signature)
  })
  m.candidates.forEach((r, i) => {
    const path = `$.candidates[${i}]`
    ref(r.target, `${path}.target`)
    if (!['asset', 'appearance', 'shot'].includes(r.target.kind))
      fail(
        `${path}.target.kind`,
        'purpose',
        'Media candidates require asset, appearance or shot target'
      )
    if (r.purpose === 'shot-video' && r.target.kind !== 'shot')
      fail(`${path}.purpose`, 'purpose', 'Shot video requires shot target')
    const object = lookup(media, r.mediaId, `${path}.mediaId`)
    if (object && !mediaSupportsPurpose(object, r.purpose))
      fail(
        `${path}.mediaId`,
        'purpose',
        'Media kind is incompatible with purpose'
      )
    if (r.source.kind === 'generation') {
      const prompt = lookup(
        prompts,
        r.source.promptRevisionId,
        `${path}.source.promptRevisionId`
      )
      if (prompt && !sameVersion(prompt.target, r.target))
        fail(
          `${path}.source.promptRevisionId`,
          'version',
          'Prompt target differs from candidate target'
        )
      if (
        prompt?.model &&
        JSON.stringify(prompt.model) !== JSON.stringify(r.source.model)
      )
        fail(
          `${path}.source.model`,
          'version',
          'Model differs from pinned prompt model'
        )
    }
  })
  const bindingSlots = new Set<string>()
  m.bindings.forEach((r, i) => {
    const path = `$.bindings[${i}]`
    ref(r.target, `${path}.target`)
    if (r.target.kind !== 'scene' && r.target.kind !== 'shot')
      fail(
        `${path}.target.kind`,
        'purpose',
        'Binding requires script scene or shot version'
      )
    const asset = lookup(
      revisions,
      r.assetRevisionId,
      `${path}.assetRevisionId`
    )
    const object = lookup(media, r.mediaId, `${path}.mediaId`)
    if (object && !mediaSupportsPurpose(object, r.purpose))
      fail(
        `${path}.mediaId`,
        'purpose',
        'Media kind is incompatible with purpose'
      )
    const appearance =
      r.appearanceRevisionId === null
        ? undefined
        : lookup(
            appearances,
            r.appearanceRevisionId,
            `${path}.appearanceRevisionId`
          )
    if (appearance && appearance.characterRevisionId !== r.assetRevisionId)
      fail(
        `${path}.appearanceRevisionId`,
        'version',
        'Appearance belongs to another character revision'
      )
    const candidate = lookup(candidates, r.candidateId, `${path}.candidateId`)
    if (candidate) {
      const expected: VersionRef = {
        projectId: m.projectId,
        kind: appearance ? 'appearance' : 'asset',
        objectId: appearance ? appearance.appearanceId : (asset?.assetId ?? ''),
        revisionId: appearance
          ? appearance.appearanceRevisionId
          : r.assetRevisionId
      }
      if (!sameVersion(candidate.target, expected))
        fail(
          `${path}.candidateId`,
          'version',
          'Candidate belongs to another asset/appearance revision'
        )
      if (
        candidate.mediaId !== r.mediaId ||
        candidate.slotId !== r.slotId ||
        candidate.purpose !== r.purpose
      )
        fail(
          `${path}.candidateId`,
          'version',
          'Binding must pin candidate media, slot and purpose'
        )
      if (candidate.technicalStatus !== 'passed')
        fail(
          `${path}.candidateId`,
          'purpose',
          'Binding requires technically checked candidate'
        )
    }
    const slot = JSON.stringify([
      adoptionSlotKey(r),
      r.assetRevisionId,
      r.appearanceRevisionId
    ])
    if (bindingSlots.has(slot))
      fail(
        `${path}.slotId`,
        'duplicate',
        'Duplicate binding for target/asset/slot'
      )
    bindingSlots.add(slot)
  })
  m.reviews.forEach((r, i) => {
    const path = `$.reviews[${i}]`
    ref(r.target, `${path}.target`)
    if (r.mediaId !== null) lookup(media, r.mediaId, `${path}.mediaId`)
    if (
      r.result === 'PASS' &&
      r.issues.some((v) => v.severity === 'critical' || v.severity === 'major')
    )
      fail(
        `${path}.result`,
        'purpose',
        'PASS contradicts blocking review issues'
      )
  })
  m.adoptions.forEach((r, i) => {
    const path = `$.adoptions[${i}]`
    ref(r.target, `${path}.target`)
    const candidate = lookup(candidates, r.candidateId, `${path}.candidateId`)
    if (
      candidate &&
      (!sameVersion(candidate.target, r.target) ||
        candidate.slotId !== r.slotId ||
        candidate.purpose !== r.purpose)
    )
      fail(
        `${path}.candidateId`,
        'version',
        'Candidate target, slot or purpose differs from adoption'
      )
    if (candidate && candidate.technicalStatus !== 'passed')
      fail(
        `${path}.candidateId`,
        'purpose',
        'Adoption requires technically checked candidate'
      )
    unique(r.reviewIds, `${path}.reviewIds`)
    r.reviewIds.forEach((v, j) => {
      const review = lookup(reviews, v, `${path}.reviewIds[${j}]`)
      if (
        review &&
        (!sameVersion(review.target, r.target) ||
          review.mediaId !== candidate?.mediaId)
      )
        fail(
          `${path}.reviewIds[${j}]`,
          'version',
          'Review belongs to another target or media'
        )
      if (review && review.result !== 'PASS')
        fail(
          `${path}.reviewIds[${j}]`,
          'purpose',
          'Adoption references a non-passing review'
        )
    })
    const seen = new Set([r.adoptionId])
    let previous = r.previousAdoptionId
    while (previous !== null) {
      if (seen.has(previous)) {
        fail(`${path}.previousAdoptionId`, 'history', 'Cyclic adoption history')
        break
      }
      seen.add(previous)
      const record = lookup(adoptions, previous, `${path}.previousAdoptionId`)
      if (!record) break
      if (
        adoptionSlotKey(record) !== adoptionSlotKey(r) ||
        record.purpose !== r.purpose
      ) {
        fail(
          `${path}.previousAdoptionId`,
          'history',
          'Previous adoption belongs to another version/slot/purpose'
        )
        break
      }
      previous = record.previousAdoptionId
    }
  })
  unique(m.currentAdoptionIds, '$.currentAdoptionIds')
  const currentSlots = new Set<string>()
  m.currentAdoptionIds.forEach((v, i) => {
    const r = lookup(adoptions, v, `$.currentAdoptionIds[${i}]`)
    if (!r) return
    const key = adoptionSlotKey(r)
    if (currentSlots.has(key))
      fail(
        `$.currentAdoptionIds[${i}]`,
        'history',
        'Only one current adoption per version and slot'
      )
    currentSlots.add(key)
  })
  m.cuts.forEach((r, i) => {
    const path = `$.cuts[${i}]`
    lookup(scripts, r.scriptRevisionId, `${path}.scriptRevisionId`)
    r.clips.forEach((clip, j) => {
      const p = `${path}.clips[${j}]`
      const shot = lookup(shots, clip.shotRevisionId, `${p}.shotRevisionId`)
      const object = lookup(media, clip.mediaId, `${p}.mediaId`)
      const adoption = lookup(adoptions, clip.adoptionId, `${p}.adoptionId`)
      if (shot && shot.scriptRevisionId !== r.scriptRevisionId)
        fail(
          `${p}.shotRevisionId`,
          'version',
          'Shot belongs to another script revision'
        )
      if (object && object.kind !== 'video')
        fail(`${p}.mediaId`, 'purpose', 'Cut clip requires video')
      if (
        clip.outSeconds <= clip.inSeconds ||
        (object?.kind === 'video' && clip.outSeconds > object.durationSeconds)
      )
        fail(
          `${p}.outSeconds`,
          'purpose',
          'Invalid or out-of-bounds trim range'
        )
      if (
        adoption &&
        (adoption.target.kind !== 'shot' ||
          adoption.target.revisionId !== clip.shotRevisionId ||
          adoption.purpose !== 'shot-video' ||
          candidates.get(adoption.candidateId)?.mediaId !== clip.mediaId)
      )
        fail(
          `${p}.adoptionId`,
          'version',
          'Cut must pin the exact historical shot video adoption'
        )
    })
    r.audioTracks.forEach((track, j) => {
      const p = `${path}.audioTracks[${j}]`
      const object = lookup(media, track.mediaId, `${p}.mediaId`)
      if (object && object.kind !== 'audio')
        fail(`${p}.mediaId`, 'purpose', 'Audio track requires audio')
      if (
        track.outSeconds <= track.inSeconds ||
        (object?.kind === 'audio' && track.outSeconds > object.durationSeconds)
      )
        fail(
          `${p}.outSeconds`,
          'purpose',
          'Invalid or out-of-bounds audio trim range'
        )
    })
  })
  return issues
}
