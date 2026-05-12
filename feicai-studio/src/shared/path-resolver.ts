import type { ProjectConfig } from './types'
import { normalizeProjectConfig } from './project-config'
import {
  ARTIFACT_REGISTRY,
  type EpisodeArtifactId,
  type ProjectArtifactId,
  type ProjectLayout
} from './artifact-registry'

function trimTrailingSlash(input: string): string {
  return input.replace(/[\\/]+$/, '')
}

export function formatEpisodeNumber(episodeNum: number): string {
  return `ep${String(episodeNum).padStart(2, '0')}`
}

export function resolveProjectLayout(
  config?: Partial<ProjectConfig> | null
): ProjectLayout {
  const normalized = normalizeProjectConfig(config)
  const dirs = normalized.directories || {}

  const sourceDir = dirs.sourceDir || 'source'
  const storyDir = dirs.storyDir || 'story'
  const scriptDir = dirs.scriptDir || 'script'
  const assetsDir = dirs.assetsDir || 'assets'
  const outputsDir = dirs.outputsDir || 'outputs'
  const reviewsDir = dirs.reviewsDir || 'reviews'

  return {
    sourceDir,
    sourceNotesDir: `${sourceDir}/notes`,
    storyDir,
    storyEpisodeBeatsDir: `${storyDir}/episode-beats`,
    scriptDir,
    assetsDir,
    assetsCharactersDir: `${assetsDir}/characters`,
    assetsArtDir: `${assetsDir}/art`,
    assetsScenesDir: `${assetsDir}/scenes`,
    outputsDir,
    reviewsDir,
    storyReviewsDir: `${reviewsDir}/story`,
    scriptReviewsDir: `${reviewsDir}/script`,
    storyboardReviewsDir: `${reviewsDir}/storyboard`,
    exportsDir: 'exports'
  }
}

export function getProjectArtifactRelativePath(
  artifactId: ProjectArtifactId,
  config?: Partial<ProjectConfig> | null
): string {
  const artifact = ARTIFACT_REGISTRY[artifactId]
  return artifact.resolveRelativePath(resolveProjectLayout(config))
}

export function getEpisodeArtifactRelativePath(
  artifactId: EpisodeArtifactId,
  episodeNum: number | 'epXX',
  config?: Partial<ProjectConfig> | null
): string {
  const artifact = ARTIFACT_REGISTRY[artifactId]
  const token =
    typeof episodeNum === 'number'
      ? formatEpisodeNumber(episodeNum)
      : episodeNum
  return artifact.resolveRelativePath(resolveProjectLayout(config), token)
}

export function buildProjectPath(
  projectPath: string,
  relativePath: string
): string {
  const normalizedRoot = trimTrailingSlash(projectPath)
  return relativePath ? `${normalizedRoot}/${relativePath}` : normalizedRoot
}

export function resolveProjectArtifactPath(
  projectPath: string,
  artifactId: ProjectArtifactId,
  config?: Partial<ProjectConfig> | null
): string {
  return buildProjectPath(
    projectPath,
    getProjectArtifactRelativePath(artifactId, config)
  )
}

export function resolveEpisodeArtifactPath(
  projectPath: string,
  artifactId: EpisodeArtifactId,
  episodeNum: number,
  config?: Partial<ProjectConfig> | null
): string {
  return buildProjectPath(
    projectPath,
    getEpisodeArtifactRelativePath(artifactId, episodeNum, config)
  )
}

export function describeProjectArtifact(
  artifactId: ProjectArtifactId,
  config?: Partial<ProjectConfig> | null
): string {
  return getProjectArtifactRelativePath(artifactId, config)
}

export function describeEpisodeArtifact(
  artifactId: EpisodeArtifactId,
  config?: Partial<ProjectConfig> | null
): string {
  return getEpisodeArtifactRelativePath(artifactId, 'epXX', config)
}
