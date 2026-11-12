import { describe, expect, it } from 'vitest'
import {
  PROJECT_ARTIFACT_REGISTRY,
  EPISODE_ARTIFACT_REGISTRY
} from '../artifact-registry'
import {
  buildProjectPath,
  getEpisodeArtifactRelativePath,
  getProjectArtifactRelativePath,
  resolveProjectLayout
} from '../path-resolver'
import {
  decodeProductionManifest,
  getProductionPaths,
  isProductionRelativePath
} from './index'
import { productionFixture } from './fixtures'

const config = {
  directories: {
    assetsDir: 'custom/library',
    outputsDir: 'render/results',
    scriptDir: 'writing/scripts',
    storyDir: 'writing/story',
    reviewsDir: 'checks'
  }
}

describe('portable production paths and existing artifact layout', () => {
  it.each([
    '../a.png',
    '/a.png',
    'a/../b.png',
    'a/./b.png',
    'a//b.png',
    'a\\b.png',
    'C:/a.png',
    'https://x/a.png',
    'a/%2e%2e/b.png',
    'a.png?token=x',
    'a.png#x',
    'a\u0000.png',
    'a\nb.png',
    './a.png',
    'a/',
    'a./b.png',
    'a /b.png',
    'CON.png',
    'x/LPT1.png',
    ''
  ])('rejects noncanonical relative path %j', (path) => {
    expect(isProductionRelativePath(path)).toBe(false)
    const m = productionFixture()
    m.media[0].relativePath = path
    const decoded = decodeProductionManifest(m)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok)
      expect(decoded.issues).toContainEqual(
        expect.objectContaining({ path: '$.media[0].relativePath' })
      )
  })
  it('resolves production locations using existing configured assets/output directories', () => {
    const layout = resolveProjectLayout(config)
    const paths = getProductionPaths(layout)
    expect(paths).toEqual({
      manifest: 'render/results/production/manifest.v1.json',
      assetMedia: 'custom/library/media',
      outputMedia: 'render/results/media',
      thumbnails: 'custom/library/thumbnails',
      operations: 'render/results/production/operations'
    })
    const m = productionFixture()
    m.media.forEach((media) => {
      media.relativePath = media.relativePath
        .replace(/^assets\//, 'custom/library/')
        .replace(/^outputs\//, 'render/results/')
    })
    expect(decodeProductionManifest(m, { layout }).ok).toBe(true)
    expect(decodeProductionManifest(m).ok).toBe(false)
    m.media[0].relativePath = 'assets/media/front.png'
    expect(decodeProductionManifest(m, { layout }).ok).toBe(false)
  })
  it('rejects prefix lookalikes, conflicting path facts and extension/type mismatches', () => {
    const m = productionFixture()
    m.media[0].relativePath = 'assets/media-other/a.png'
    expect(decodeProductionManifest(m).ok).toBe(false)
    m.media[0].relativePath = 'assets/media/a.mp4'
    expect(decodeProductionManifest(m).ok).toBe(false)
    m.media[0].relativePath = 'assets/media/same.png'
    m.media[1] = {
      ...m.media[0],
      mediaId: 'image-profile',
      relativePath: 'assets/media/SAME.png',
      contentHash: 'b'.repeat(64)
    }
    expect(decodeProductionManifest(m).ok).toBe(false)
    m.media[1] = { ...m.media[0], mediaId: 'image-profile' }
    expect(decodeProductionManifest(m).ok).toBe(true)
  })
  it('validates layout even when manifest has no media', () => {
    expect(() =>
      getProductionPaths({ assetsDir: '../bad', outputsDir: 'ok' })
    ).toThrow()
    const result = decodeProductionManifest(productionFixture(), {
      layout: { assetsDir: 'assets', outputsDir: '/absolute' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: '$layout', code: 'path' })
      )
  })
  it('retains every existing artifact registry resolver and custom directory mapping', () => {
    for (const artifact of Object.values(PROJECT_ARTIFACT_REGISTRY)) {
      expect(
        getProjectArtifactRelativePath(
          artifact.id as keyof typeof PROJECT_ARTIFACT_REGISTRY,
          config
        )
      ).toBe(artifact.resolveRelativePath(resolveProjectLayout(config)))
    }
    for (const artifact of Object.values(EPISODE_ARTIFACT_REGISTRY)) {
      expect(
        getEpisodeArtifactRelativePath(
          artifact.id as keyof typeof EPISODE_ARTIFACT_REGISTRY,
          2,
          config
        )
      ).toBe(artifact.resolveRelativePath(resolveProjectLayout(config), 'ep02'))
    }
    expect(getProjectArtifactRelativePath('characterPrompts', config)).toBe(
      'custom/library/character-prompts.md'
    )
    expect(getEpisodeArtifactRelativePath('directorAnalysis', 2, config)).toBe(
      'render/results/ep02/01-director-analysis.md'
    )
    expect(getEpisodeArtifactRelativePath('script', 'epXX', config)).toBe(
      'writing/scripts/epXX.md'
    )
    expect(
      buildProjectPath('/root/project/', 'custom/library/media/a.png')
    ).toBe('/root/project/custom/library/media/a.png')
  })
})
