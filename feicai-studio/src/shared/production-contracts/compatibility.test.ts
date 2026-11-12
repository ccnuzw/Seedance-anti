import { describe, expect, it } from 'vitest'
import { checkProductionCompatibility, previewLegacyProduction } from './index'
import { productionFixture } from './fixtures'

function legacyFixture() {
  return {
    projectId: 'project-1',
    scripts: [
      {
        relativePath: 'writing/ep01.md',
        markdown:
          '# Legacy script\n\nNo confirmed scene boundary.\n\n原文完整保留。'
      }
    ],
    characters: [
      {
        id: 'temporary-uuid-1',
        projectId: '',
        name: '林',
        alias: '阿林',
        promptText: '第一人',
        referenceImagePath: '/legacy/absolute/reference.png',
        age: '20'
      },
      {
        id: 'temporary-uuid-2',
        projectId: 'project-1',
        name: '林',
        promptText: '第二人',
        firstEpisode: 2
      }
    ],
    scenes: [
      {
        id: 'temporary-scene',
        projectId: '',
        name: '林',
        promptText: '一个森林',
        lighting: 'day'
      }
    ]
  }
}

describe('read-only compatibility preview', () => {
  it('separates current compatibility, unsupported schemas and invalid data', () => {
    expect(checkProductionCompatibility(productionFixture()).status).toBe(
      'compatible'
    )
    expect(checkProductionCompatibility({ schemaVersion: 3 }).status).toBe(
      'unsupported'
    )
    expect(checkProductionCompatibility(legacyFixture()).status).toBe('invalid')
  })
  it('preserves original Markdown and independent same-name objects, never inventing stable migration IDs', () => {
    const input = legacyFixture(),
      snapshot = JSON.stringify(input)
    const result = previewLegacyProduction(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('needs-confirmation')
    expect(result.value.scripts[0]).toEqual({
      ...input.scripts[0],
      stableScriptId: null,
      stableRevisionId: null,
      status: 'needs-confirmation'
    })
    expect(result.value.assets).toHaveLength(3)
    expect(result.value.assets.map((a) => a.legacyId)).toEqual([
      'temporary-uuid-1',
      'temporary-uuid-2',
      'temporary-scene'
    ])
    expect(
      result.value.assets.every(
        (a) => a.stableAssetId === null && a.stableRevisionId === null
      )
    ).toBe(true)
    expect(result.value.sameNameGroups).toEqual([
      { name: '林', assetIndexes: [0, 1, 2] }
    ])
    expect(result.value.assets[0].reasons).toEqual([
      'unstable-identity',
      'unverified-media',
      'same-name'
    ])
    expect(JSON.stringify(input)).toBe(snapshot)
    result.value.assets[0].name = 'preview only'
    expect(JSON.stringify(input)).toBe(snapshot)
  })
  it('treats repeated temporary IDs as evidence requiring confirmation, never as identity or merge keys', () => {
    const input = legacyFixture()
    input.characters[1].id = input.characters[0].id
    input.characters[1].name = 'different object'
    const result = previewLegacyProduction(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assets).toHaveLength(3)
    expect(result.value.assets[0].sourceIndex).toBe(0)
    expect(result.value.assets[1].sourceIndex).toBe(1)
  })
  it('rejects explicit cross-project evidence and malformed known fields without reading media paths', () => {
    const input = legacyFixture()
    input.characters[0].projectId = 'project-other'
    const result = previewLegacyProduction(input)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          path: '$.characters[0].projectId',
          code: 'project'
        })
      )
    expect(
      previewLegacyProduction({
        ...legacyFixture(),
        scenes: [{ id: 'x', projectId: '', name: 42, promptText: '' }]
      }).ok
    ).toBe(false)
    input.scripts[0].relativePath = '../untrusted.md'
    expect(previewLegacyProduction(input).ok).toBe(false)
  })
  it('does not fill absent reference media, hash, scene anchors or stable versions', () => {
    const result = previewLegacyProduction(legacyFixture())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assets[1].referenceImagePath).toBeUndefined()
    expect(result.value.scripts[0]).not.toHaveProperty('scenes')
    expect(result.value.assets[0]).not.toHaveProperty('contentHash')
  })
})
