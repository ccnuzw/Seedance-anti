import { describe, expect, it } from 'vitest'
import { buildReleaseArchiveManifest } from './release-archive.mjs'

describe('release-archive', () => {
  it('builds a deterministic archive manifest', () => {
    const manifest = buildReleaseArchiveManifest({
      generatedAt: '2026-03-24T12:34:56.000Z',
      artifacts: [
        { path: 'pack-verify-report.json', sizeBytes: 128, sha256: 'abc' }
      ]
    })

    expect(manifest.archiveId).toBe('release-20260324T123456Z')
    expect(manifest.artifactCount).toBe(1)
    expect(manifest.artifacts[0]?.path).toBe('pack-verify-report.json')
  })
})
