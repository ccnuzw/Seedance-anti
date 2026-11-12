import { describe, expect, it } from 'vitest'
import {
  decodeProductionManifest,
  decodeProductionManifestUpdate,
  parseProductionManifest,
  adoptionSlotKey,
  sameVersion,
  type DecodeResult,
  type ProductionManifest
} from './index'
import { fixtureRef, productionFixture } from './fixtures'

function issues(
  result: DecodeResult<unknown>
): { path: string; code: string }[] {
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.issues
}
function rejects(
  change: (m: ProductionManifest) => void,
  path: string,
  code?: string
): void {
  const m = productionFixture()
  change(m)
  expect(issues(decodeProductionManifest(m))).toContainEqual(
    expect.objectContaining({ path, ...(code ? { code } : {}) })
  )
}

describe('production manifest runtime boundary', () => {
  it('decodes complete portable history into detached data, including all asset and media types', () => {
    const input = productionFixture()
    const decoded = parseProductionManifest(JSON.stringify(input))
    expect(decoded).toEqual({ ok: true, value: input })
    if (!decoded.ok) return
    decoded.value.assets[0].name = 'detached'
    expect(input.assets[0].name).toBe('hero')
    expect(decoded.value.assets.map((a) => a.type)).toEqual([
      'character',
      'scene',
      'prop',
      'costume',
      'makeup'
    ])
  })
  it.each([0, 2, '1', null])(
    'rejects unsupported schema %s without a fallback',
    (version) => {
      const input = { ...productionFixture(), schemaVersion: version }
      expect(issues(decodeProductionManifest(input))).toEqual([
        expect.objectContaining({
          path: '$.schemaVersion',
          code: 'unknown_schema'
        })
      ])
    }
  )
  it.each([null, [], 'text', {}, { schemaVersion: 1 }])(
    'rejects malformed roots %j',
    (input) => {
      expect(decodeProductionManifest(input).ok).toBe(false)
    }
  )
  it('reports invalid JSON, missing fields, unknown fields and invalid discriminators', () => {
    expect(issues(parseProductionManifest('{broken'))[0].path).toBe('$')
    const m = productionFixture()
    const { assets: _assets, ...missing } = m
    expect(issues(decodeProductionManifest(missing))).toContainEqual(
      expect.objectContaining({ path: '$.assets' })
    )
    expect(
      issues(decodeProductionManifest({ ...m, adopted: true }))
    ).toContainEqual(expect.objectContaining({ path: '$.adopted' }))
    expect(
      issues(
        decodeProductionManifest({
          ...m,
          media: [{ ...m.media[0], kind: 'unknown' }]
        })
      )
    ).toContainEqual(expect.objectContaining({ path: '$.media[0].kind' }))
  })
  it.each([
    [
      '$.media[0].contentHash',
      (m: ProductionManifest) => {
        m.media[0].contentHash = 'abc'
      }
    ],
    [
      '$.assetRevisions[0].contentHash',
      (m: ProductionManifest) => {
        m.assetRevisions[0].contentHash = 'A'.repeat(64)
      }
    ],
    [
      '$.media[0].byteLength',
      (m: ProductionManifest) => {
        m.media[0].byteLength = 0
      }
    ],
    [
      '$.media[0].width',
      (m: ProductionManifest) => {
        if (m.media[0].kind === 'image') m.media[0].width = 0
      }
    ],
    [
      '$.media[0].height',
      (m: ProductionManifest) => {
        if (m.media[0].kind === 'image') m.media[0].height = 1.5
      }
    ],
    [
      '$.media[2].durationSeconds',
      (m: ProductionManifest) => {
        if (m.media[2].kind === 'video') m.media[2].durationSeconds = Infinity
      }
    ],
    [
      '$.media[4].channels',
      (m: ProductionManifest) => {
        if (m.media[4].kind === 'audio') m.media[4].channels = -1
      }
    ],
    [
      '$.media[4].sampleRate',
      (m: ProductionManifest) => {
        if (m.media[4].kind === 'audio') m.media[4].sampleRate = 0
      }
    ],
    [
      '$.shots[0].durationSeconds',
      (m: ProductionManifest) => {
        m.shots[0].durationSeconds = NaN
      }
    ],
    [
      '$.scenes[0].order',
      (m: ProductionManifest) => {
        m.scenes[0].order = -1
      }
    ],
    [
      '$.candidates[0].createdAt',
      (m: ProductionManifest) => {
        m.candidates[0].createdAt = '2026-02-30T10:00:00.000Z'
      }
    ],
    [
      '$.assets[0].assetId',
      (m: ProductionManifest) => {
        m.assets[0].assetId = 'name with spaces'
      }
    ]
  ] as const)('rejects invalid basic metadata at %s', (path, change) =>
    rejects(change, path, 'schema')
  )
  it('rejects fields from the wrong media variant and mismatched MIME', () => {
    const m = productionFixture()
    expect(
      issues(
        decodeProductionManifest({
          ...m,
          media: [{ ...m.media[0], durationSeconds: 3 }]
        })
      )
    ).toContainEqual(
      expect.objectContaining({ path: '$.media[0].durationSeconds' })
    )
    expect(
      issues(
        decodeProductionManifest({
          ...m,
          media: [{ ...m.media[0], mimeType: 'video/mp4' }]
        })
      )
    ).toContainEqual(expect.objectContaining({ path: '$.media[0].mimeType' }))
  })
})

describe('version relationships', () => {
  it('pins historical script, shot, asset and adopted media even when newer versions exist', () => {
    const m = productionFixture()
    expect(decodeProductionManifest(m).ok).toBe(true)
    expect(m.bindings[0].assetRevisionId).toBe('hero-r1')
    expect(m.cuts[0].clips[0].adoptionId).toBe('adopt-video-1')
    expect(m.currentAdoptionIds).toContain('adopt-video-2')
  })
  it('distinguishes a script occurrence from the reusable scene asset', () => {
    rejects(
      (m) => {
        m.shots[0].sceneId = 'courtyard'
      },
      '$.shots[0].sceneId',
      'reference'
    )
  })
  it('rejects cross-project entities and nested references', () => {
    rejects(
      (m) => {
        m.media[0].projectId = 'other-project'
      },
      '$.media[0].projectId',
      'project'
    )
    rejects(
      (m) => {
        m.candidates[0].target.projectId = 'other-project'
      },
      '$.candidates[0].target.projectId',
      'project'
    )
  })
  it.each([
    [
      '$.bindings[0].assetRevisionId',
      (m: ProductionManifest) => {
        m.bindings[0].assetRevisionId = 'missing'
      }
    ],
    [
      '$.bindings[0].candidateId',
      (m: ProductionManifest) => {
        m.bindings[0].candidateId = 'missing'
      }
    ],
    [
      '$.candidates[0].mediaId',
      (m: ProductionManifest) => {
        m.candidates[0].mediaId = 'missing'
      }
    ],
    [
      '$.promptRevisions[0].inputs[0].revisionId',
      (m: ProductionManifest) => {
        m.promptRevisions[0].inputs[0].revisionId = 'missing'
      }
    ],
    [
      '$.shots[0].sceneId',
      (m: ProductionManifest) => {
        m.shots[0].scriptRevisionId = 'missing-script'
      }
    ],
    [
      '$.currentAdoptionIds[0]',
      (m: ProductionManifest) => {
        m.currentAdoptionIds[0] = 'missing'
      }
    ]
  ] as const)('rejects dangling references at %s', (path, change) =>
    rejects(change, path, 'reference')
  )
  it('rejects correct revision ID belonging to the wrong logical object', () => {
    rejects(
      (m) => {
        m.candidates[0].target.objectId = 'pendant'
      },
      '$.candidates[0].target.objectId',
      'version'
    )
    rejects(
      (m) => {
        m.bindings[0].assetRevisionId = 'hero-r2'
      },
      '$.bindings[0].candidateId',
      'version'
    )
    rejects(
      (m) => {
        m.cuts[0].scriptRevisionId = 'script-r2'
      },
      '$.cuts[0].clips[0].shotRevisionId',
      'version'
    )
  })
  it('rejects duplicate IDs and cyclic or foreign version ancestry', () => {
    rejects(
      (m) => {
        m.assets.push({ ...m.assets[0] })
      },
      '$.assets[5]',
      'duplicate'
    )
    rejects(
      (m) => {
        m.assetRevisions[0].parentRevisionId = 'hero-r2'
      },
      '$.assetRevisions[0].parentRevisionId',
      'history'
    )
    rejects(
      (m) => {
        m.assetRevisions[0].parentRevisionId = 'dress-r1'
      },
      '$.assetRevisions[0].parentRevisionId',
      'version'
    )
    rejects(
      (m) => {
        m.scriptRevisions[1].episodeNumber = 2
      },
      '$.scriptRevisions[1]',
      'version'
    )
    rejects(
      (m) => {
        m.assetRevisions[0].assetId = 'hero-r1'
      },
      '$.assetRevisions[0]',
      'version'
    )
  })
  it('validates character/costume/makeup composition and its exact base version', () => {
    rejects(
      (m) => {
        m.appearances[0].costumeRevisionIds = ['pendant-r1']
      },
      '$.appearances[0].costumeRevisionIds[0]',
      'version'
    )
    rejects(
      (m) => {
        m.appearances[0].characterRevisionId = 'courtyard-r1'
      },
      '$.appearances[0].characterRevisionId',
      'version'
    )
    const m = productionFixture()
    m.bindings[0] = {
      ...m.bindings[0],
      appearanceRevisionId: 'banquet-r1',
      candidateId: 'look',
      mediaId: 'image-profile'
    }
    expect(decodeProductionManifest(m).ok).toBe(true)
    m.bindings[0].assetRevisionId = 'hero-r2'
    expect(issues(decodeProductionManifest(m))).toContainEqual(
      expect.objectContaining({
        path: '$.bindings[0].appearanceRevisionId',
        code: 'version'
      })
    )
  })
  it('checks generated candidate prompt target and external pinned model reference', () => {
    rejects(
      (m) => {
        m.promptRevisions[0].target = fixtureRef('asset', 'hero', 'hero-r2')
      },
      '$.candidates[0].source.promptRevisionId',
      'version'
    )
    rejects(
      (m) => {
        const source = m.candidates[0].source
        if (source.kind === 'generation')
          source.model = { ...source.model, version: '2' }
      },
      '$.candidates[0].source.model',
      'version'
    )
  })
})

describe('slots, media and adoption history', () => {
  it('allows independently adopted front and profile images of one exact asset version', () => {
    const m = productionFixture()
    expect(decodeProductionManifest(m).ok).toBe(true)
    expect(adoptionSlotKey(m.adoptions[0])).not.toBe(
      adoptionSlotKey(m.adoptions[1])
    )
    expect(sameVersion(m.adoptions[0].target, m.adoptions[1].target)).toBe(true)
    expect(m.candidates[0].mediaId).not.toBe(m.candidates[1].mediaId)
  })
  it('rejects two current adoptions in one slot and history across different slots', () => {
    rejects(
      (m) => {
        m.currentAdoptionIds.push('adopt-video-1')
      },
      '$.currentAdoptionIds[3]',
      'history'
    )
    rejects(
      (m) => {
        m.adoptions[1].previousAdoptionId = 'adopt-front'
      },
      '$.adoptions[1].previousAdoptionId',
      'history'
    )
    rejects(
      (m) => {
        m.adoptions[2].previousAdoptionId = 'adopt-video-2'
      },
      '$.adoptions[2].previousAdoptionId',
      'history'
    )
  })
  it('rejects mismatched slots, media and purposes on bindings/adoption', () => {
    rejects(
      (m) => {
        m.bindings[0].slotId = 'profile'
      },
      '$.bindings[0].candidateId',
      'version'
    )
    rejects(
      (m) => {
        m.bindings[0].mediaId = 'image-profile'
      },
      '$.bindings[0].candidateId',
      'version'
    )
    rejects(
      (m) => {
        m.adoptions[0].candidateId = 'profile'
      },
      '$.adoptions[0].candidateId',
      'version'
    )
    rejects(
      (m) => {
        m.candidates[0].mediaId = 'video-old'
      },
      '$.candidates[0].mediaId',
      'purpose'
    )
    rejects(
      (m) => {
        m.candidates[4].mediaId = 'image-front'
      },
      '$.candidates[4].mediaId',
      'purpose'
    )
    rejects(
      (m) => {
        m.candidates[6].mediaId = 'video-old'
      },
      '$.candidates[6].mediaId',
      'purpose'
    )
    rejects(
      (m) => {
        m.candidates[0].technicalStatus = 'pending'
      },
      '$.bindings[0].candidateId',
      'purpose'
    )
  })
  it.each(['first-frame', 'last-frame', 'composition'] as const)(
    'supports %s image slots without conflating purposes',
    (purpose) => {
      const m = productionFixture()
      m.candidates.push({
        ...m.candidates[1],
        candidateId: `candidate-${purpose}`,
        target: fixtureRef('shot', 'shot-a', 'shot-r1'),
        slotId: purpose,
        purpose
      })
      expect(decodeProductionManifest(m).ok).toBe(true)
    }
  )
  it('keeps technical checks, reviews and human adoption separate and validates cited reviews', () => {
    rejects(
      (m) => {
        m.reviews[0].mediaId = 'image-profile'
      },
      '$.adoptions[0].reviewIds[0]',
      'version'
    )
    rejects(
      (m) => {
        m.reviews[0].result = 'FAIL'
      },
      '$.adoptions[0].reviewIds[0]',
      'purpose'
    )
    rejects(
      (m) => {
        m.reviews[0].issues = [
          {
            code: 'missing-prop',
            severity: 'major',
            location: 'frame-1',
            evidence: 'missing pendant',
            suggestion: 'add prop'
          }
        ]
      },
      '$.reviews[0].result',
      'purpose'
    )
  })
  it('validates historical video adoption and video/audio trim ranges in cuts', () => {
    rejects(
      (m) => {
        m.cuts[0].clips[0].adoptionId = 'adopt-video-2'
      },
      '$.cuts[0].clips[0].adoptionId',
      'version'
    )
    rejects(
      (m) => {
        m.cuts[0].clips[0].outSeconds = 6
      },
      '$.cuts[0].clips[0].outSeconds',
      'purpose'
    )
    rejects(
      (m) => {
        m.cuts[0].clips[0].outSeconds = 0.5
      },
      '$.cuts[0].clips[0].outSeconds',
      'purpose'
    )
    rejects(
      (m) => {
        m.cuts[0].audioTracks[0].mediaId = 'video-old'
      },
      '$.cuts[0].audioTracks[0].mediaId',
      'purpose'
    )
    rejects(
      (m) => {
        m.cuts[0].audioTracks[0].outSeconds = 11
      },
      '$.cuts[0].audioTracks[0].outSeconds',
      'purpose'
    )
  })
})

describe('append-only update boundary', () => {
  it('renames logical assets and reorders manifest collections without changing any binding', () => {
    const before = productionFixture(),
      next = productionFixture()
    next.assets[0].name = 'New display name'
    next.assets[0].aliases.push('Hero')
    next.assets.reverse()
    next.scenes.reverse()
    next.shots.reverse()
    expect(decodeProductionManifestUpdate(before, next)).toEqual({
      ok: true,
      value: next
    })
    expect(next.bindings).toEqual(before.bindings)
  })
  it('reorders scenes/shots in a new revision while retaining stable IDs and exact historical inputs', () => {
    const m = productionFixture()
    expect(m.scenes[0].sceneId).toBe(m.scenes[1].sceneId)
    expect(m.shots[0].shotId).toBe(m.shots[1].shotId)
    expect(m.shots[0].order).not.toBe(m.shots[1].order)
    expect(decodeProductionManifest(m).ok).toBe(true)
  })
  it('rejects in-place revision edits, historical removal and asset retyping', () => {
    const before = productionFixture(),
      edited = productionFixture()
    edited.scriptRevisions[0].markdown += ' edited'
    expect(
      issues(decodeProductionManifestUpdate(before, edited))
    ).toContainEqual(
      expect.objectContaining({ path: '$.scriptRevisions[0]', code: 'history' })
    )
    const removed = productionFixture()
    removed.assetRevisions.pop()
    removed.candidates = removed.candidates.filter(
      (c) => c.candidateId !== 'new-setting'
    )
    expect(
      issues(decodeProductionManifestUpdate(before, removed))
    ).toContainEqual(
      expect.objectContaining({ path: '$.assetRevisions', code: 'history' })
    )
    const retyped = productionFixture()
    retyped.assets[2].type = 'costume'
    expect(
      issues(decodeProductionManifestUpdate(before, retyped))
    ).toContainEqual(
      expect.objectContaining({ path: '$.assets[2]', code: 'history' })
    )
  })
  it('restores old media by appending adoption, preserving previous history and cut', () => {
    const before = productionFixture(),
      next = productionFixture()
    next.adoptions.push({
      ...next.adoptions[2],
      adoptionId: 'adopt-rollback',
      previousAdoptionId: 'adopt-video-2'
    })
    next.currentAdoptionIds[2] = 'adopt-rollback'
    expect(decodeProductionManifestUpdate(before, next).ok).toBe(true)
    expect(next.cuts).toEqual(before.cuts)
    const rewound = productionFixture()
    rewound.currentAdoptionIds[2] = 'adopt-video-1'
    expect(
      issues(decodeProductionManifestUpdate(before, rewound))
    ).toContainEqual(
      expect.objectContaining({ path: '$.currentAdoptionIds', code: 'history' })
    )
  })
  it('rejects bypassing current history, removing a current slot or mutating prior adoptions', () => {
    const before = productionFixture(),
      bypass = productionFixture()
    bypass.adoptions.push({
      ...bypass.adoptions[2],
      adoptionId: 'bypass',
      previousAdoptionId: null
    })
    bypass.currentAdoptionIds[2] = 'bypass'
    expect(
      issues(decodeProductionManifestUpdate(before, bypass))
    ).toContainEqual(expect.objectContaining({ path: '$.currentAdoptionIds' }))
    const missing = productionFixture()
    missing.currentAdoptionIds.pop()
    expect(decodeProductionManifestUpdate(before, missing).ok).toBe(false)
    const changed = productionFixture()
    changed.adoptions[2].actor = 'other'
    expect(
      issues(decodeProductionManifestUpdate(before, changed))
    ).toContainEqual(expect.objectContaining({ path: '$.adoptions[2]' }))
  })
  it('allows a pending technical check to complete, keeping checked facts immutable', () => {
    const before = productionFixture()
    before.candidates[2].technicalStatus = 'pending'
    const next = productionFixture()
    expect(decodeProductionManifestUpdate(before, next).ok).toBe(true)
    before.candidates[2].technicalStatus = 'failed'
    expect(decodeProductionManifestUpdate(before, next).ok).toBe(false)
  })
  it('validates both old and proposed data before comparing history', () => {
    const invalid = { ...productionFixture(), schemaVersion: 2 }
    expect(
      issues(decodeProductionManifestUpdate(invalid, productionFixture()))[0]
        .path
    ).toBe('$previous.schemaVersion')
    expect(
      issues(decodeProductionManifestUpdate(productionFixture(), invalid))[0]
        .code
    ).toBe('unknown_schema')
  })
})
