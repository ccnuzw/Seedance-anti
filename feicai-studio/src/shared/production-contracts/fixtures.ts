import type {
  AssetType,
  ProductionManifest,
  VersionKind,
  VersionRef
} from './model'

export const fixtureHash = 'a'.repeat(64)
export const fixtureDate = '2026-06-01T10:00:00.000Z'
export const externalRef = {
  id: 'external-rules',
  version: '1.0.0',
  contentHash: fixtureHash
}
export function fixtureRef(
  kind: VersionKind,
  objectId: string,
  revisionId: string
): VersionRef {
  return { projectId: 'project-1', kind, objectId, revisionId }
}

// Synthetic, detached data: no real project paths, assets, model calls or filesystem reads.
export function productionFixture(): ProductionManifest {
  const projectId = 'project-1'
  const target = fixtureRef('asset', 'hero', 'hero-r1')
  const shotTarget = fixtureRef('shot', 'shot-a', 'shot-r1')
  const imported = {
    kind: 'import' as const,
    evidence: {
      relativePath: 'source/reference.png',
      contentHash: fixtureHash,
      anchor: 'whole-file'
    }
  }
  const assets: [string, AssetType][] = [
    ['hero', 'character'],
    ['courtyard', 'scene'],
    ['pendant', 'prop'],
    ['dress', 'costume'],
    ['makeup', 'makeup']
  ]
  return {
    schemaVersion: 1,
    projectId,
    scriptRevisions: [
      {
        projectId,
        scriptId: 'script-ep1',
        revisionId: 'script-r1',
        parentRevisionId: null,
        episodeNumber: 1,
        contentHash: fixtureHash,
        markdown: '# Original\nUnparsed **script** stays intact.',
        sources: []
      },
      {
        projectId,
        scriptId: 'script-ep1',
        revisionId: 'script-r2',
        parentRevisionId: 'script-r1',
        episodeNumber: 1,
        contentHash: 'b'.repeat(64),
        markdown: '# Revised',
        sources: []
      }
    ],
    scenes: [
      {
        projectId,
        sceneId: 'scene-occurrence',
        scriptRevisionId: 'script-r1',
        title: 'Courtyard, evening',
        order: 0,
        anchor: 'paragraph-a',
        plotPointIds: ['plot-event-1']
      },
      {
        projectId,
        sceneId: 'scene-occurrence',
        scriptRevisionId: 'script-r2',
        title: 'Courtyard, night',
        order: 2,
        anchor: 'paragraph-b',
        plotPointIds: ['plot-event-1']
      }
    ],
    shots: [
      {
        projectId,
        shotId: 'shot-a',
        shotRevisionId: 'shot-r1',
        parentRevisionId: null,
        scriptRevisionId: 'script-r1',
        sceneId: 'scene-occurrence',
        order: 0,
        action: 'Raises pendant',
        dialogue: '',
        camera: 'Close up',
        durationSeconds: 5,
        contentHash: fixtureHash
      },
      {
        projectId,
        shotId: 'shot-a',
        shotRevisionId: 'shot-r2',
        parentRevisionId: 'shot-r1',
        scriptRevisionId: 'script-r2',
        sceneId: 'scene-occurrence',
        order: 3,
        action: 'Lowers pendant',
        dialogue: '',
        camera: 'Wide',
        durationSeconds: 4,
        contentHash: 'b'.repeat(64)
      }
    ],
    assets: assets.map(([assetId, type]) => ({
      projectId,
      assetId,
      type,
      name: assetId,
      aliases: [],
      sources: []
    })),
    assetRevisions: [
      ...assets.map(([assetId]) => ({
        projectId,
        assetId,
        assetRevisionId: `${assetId}-r1`,
        parentRevisionId: null,
        description: `Description of ${assetId}`,
        contentHash: fixtureHash,
        sources: []
      })),
      {
        projectId,
        assetId: 'hero',
        assetRevisionId: 'hero-r2',
        parentRevisionId: 'hero-r1',
        description: 'Revised hero',
        contentHash: 'b'.repeat(64),
        sources: []
      }
    ],
    appearances: [
      {
        projectId,
        appearanceId: 'banquet',
        appearanceRevisionId: 'banquet-r1',
        parentRevisionId: null,
        name: 'Banquet look',
        characterRevisionId: 'hero-r1',
        costumeRevisionIds: ['dress-r1'],
        makeupRevisionIds: ['makeup-r1'],
        state: 'clean',
        contentHash: fixtureHash
      }
    ],
    promptRevisions: [
      {
        projectId,
        promptId: 'portrait',
        promptRevisionId: 'portrait-r1',
        parentRevisionId: null,
        target,
        text: 'Hero front view',
        contentHash: fixtureHash,
        template: externalRef,
        rules: [externalRef],
        skill: externalRef,
        model: externalRef,
        inputs: [target],
        mediaIds: []
      }
    ],
    media: [
      {
        projectId,
        mediaId: 'image-front',
        kind: 'image',
        mimeType: 'image/png',
        relativePath: 'assets/media/front.png',
        contentHash: fixtureHash,
        byteLength: 1024,
        width: 1024,
        height: 1536
      },
      {
        projectId,
        mediaId: 'image-profile',
        kind: 'image',
        mimeType: 'image/webp',
        relativePath: 'assets/media/profile.webp',
        contentHash: 'b'.repeat(64),
        byteLength: 2048,
        width: 1024,
        height: 1536
      },
      {
        projectId,
        mediaId: 'video-old',
        kind: 'video',
        mimeType: 'video/mp4',
        relativePath: 'outputs/media/old.mp4',
        contentHash: 'c'.repeat(64),
        byteLength: 4096,
        width: 1920,
        height: 1080,
        durationSeconds: 5,
        hasAudio: false
      },
      {
        projectId,
        mediaId: 'video-new',
        kind: 'video',
        mimeType: 'video/webm',
        relativePath: 'outputs/media/new.webm',
        contentHash: 'd'.repeat(64),
        byteLength: 8192,
        width: 1920,
        height: 1080,
        durationSeconds: 6,
        hasAudio: true
      },
      {
        projectId,
        mediaId: 'audio',
        kind: 'audio',
        mimeType: 'audio/wav',
        relativePath: 'outputs/media/score.wav',
        contentHash: 'e'.repeat(64),
        byteLength: 4096,
        durationSeconds: 10,
        channels: 2,
        sampleRate: 48000
      }
    ],
    candidates: [
      {
        projectId,
        candidateId: 'front',
        target,
        slotId: 'front',
        purpose: 'asset-reference',
        mediaId: 'image-front',
        source: {
          kind: 'generation',
          promptRevisionId: 'portrait-r1',
          operationId: 'operation-1',
          model: externalRef
        },
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'profile',
        target,
        slotId: 'profile',
        purpose: 'asset-reference',
        mediaId: 'image-profile',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'new-setting',
        target: fixtureRef('asset', 'hero', 'hero-r2'),
        slotId: 'front',
        purpose: 'asset-reference',
        mediaId: 'image-profile',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'look',
        target: fixtureRef('appearance', 'banquet', 'banquet-r1'),
        slotId: 'front',
        purpose: 'asset-reference',
        mediaId: 'image-profile',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'video-1',
        target: shotTarget,
        slotId: 'main',
        purpose: 'shot-video',
        mediaId: 'video-old',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'video-2',
        target: shotTarget,
        slotId: 'main',
        purpose: 'shot-video',
        mediaId: 'video-new',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      },
      {
        projectId,
        candidateId: 'sound',
        target: shotTarget,
        slotId: 'sound',
        purpose: 'audio-reference',
        mediaId: 'audio',
        source: imported,
        technicalStatus: 'passed',
        createdAt: fixtureDate
      }
    ],
    bindings: [
      {
        projectId,
        bindingId: 'binding-front',
        target: shotTarget,
        assetRevisionId: 'hero-r1',
        appearanceRevisionId: null,
        candidateId: 'front',
        mediaId: 'image-front',
        slotId: 'front',
        purpose: 'asset-reference',
        required: true
      }
    ],
    reviews: [
      {
        projectId,
        reviewId: 'review-front',
        target,
        mediaId: 'image-front',
        inputHash: fixtureHash,
        rules: externalRef,
        source: 'human',
        result: 'PASS',
        issues: [],
        createdAt: fixtureDate
      }
    ],
    adoptions: [
      {
        projectId,
        adoptionId: 'adopt-front',
        target,
        slotId: 'front',
        purpose: 'asset-reference',
        candidateId: 'front',
        previousAdoptionId: null,
        reviewIds: ['review-front'],
        actor: 'editor',
        createdAt: fixtureDate
      },
      {
        projectId,
        adoptionId: 'adopt-profile',
        target,
        slotId: 'profile',
        purpose: 'asset-reference',
        candidateId: 'profile',
        previousAdoptionId: null,
        reviewIds: [],
        actor: 'editor',
        createdAt: fixtureDate
      },
      {
        projectId,
        adoptionId: 'adopt-video-1',
        target: shotTarget,
        slotId: 'main',
        purpose: 'shot-video',
        candidateId: 'video-1',
        previousAdoptionId: null,
        reviewIds: [],
        actor: 'editor',
        createdAt: fixtureDate
      },
      {
        projectId,
        adoptionId: 'adopt-video-2',
        target: shotTarget,
        slotId: 'main',
        purpose: 'shot-video',
        candidateId: 'video-2',
        previousAdoptionId: 'adopt-video-1',
        reviewIds: [],
        actor: 'editor',
        createdAt: fixtureDate
      }
    ],
    currentAdoptionIds: ['adopt-front', 'adopt-profile', 'adopt-video-2'],
    cuts: [
      {
        projectId,
        cutId: 'episode-cut',
        cutRevisionId: 'cut-r1',
        parentRevisionId: null,
        scriptRevisionId: 'script-r1',
        clips: [
          {
            shotRevisionId: 'shot-r1',
            mediaId: 'video-old',
            adoptionId: 'adopt-video-1',
            inSeconds: 0.5,
            outSeconds: 4.5
          }
        ],
        audioTracks: [
          { mediaId: 'audio', startSeconds: 0, inSeconds: 0, outSeconds: 5 }
        ],
        exportSettings: {
          width: 1920,
          height: 1080,
          fps: 24,
          container: 'mp4'
        },
        contentHash: fixtureHash
      }
    ]
  }
}
