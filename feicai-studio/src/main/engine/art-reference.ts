import { readFileSync } from 'fs'
import type { ProjectConfig } from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'

type SharedArtArtifact = 'characterPrompts' | 'scenePrompts'
export interface ArtReferenceSnapshot {
  version: 1
  references: Partial<
    Record<SharedArtArtifact, { input: string; published: string }>
  >
}

export function referencePath(
  projectPath: string,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): string {
  return assertPathWithinProject(
    projectPath,
    `${resolveEpisodeArtifactPath(projectPath, 'artDesign', episodeNum, config)}.references.json`
  )
}

/** Publication may replace the shared file; retain the exact reference seen before
 * this episode published. Any later external edit exposes the current file and
 * invalidates the old review. Snapshots never rebind a review or grant PASS. */
export function readArtReference(
  projectPath: string,
  artifact: SharedArtArtifact,
  episodeNum?: number,
  config?: Partial<ProjectConfig> | null
): string {
  const path = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, artifact, config)
  )
  let current = ''
  try {
    current = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (episodeNum !== undefined) {
    assertEpisodeNumber(episodeNum)
    let snapshot: ArtReferenceSnapshot | undefined
    try {
      snapshot = JSON.parse(
        readFileSync(referencePath(projectPath, episodeNum, config), 'utf8')
      )
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        !(error instanceof SyntaxError)
      )
        throw error
    }
    const reference =
      snapshot?.version === 1 ? snapshot.references?.[artifact] : undefined
    if (
      reference &&
      typeof reference.input === 'string' &&
      reference.published === current
    )
      return reference.input
  }
  return current
}
