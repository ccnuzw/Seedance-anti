import { readJsonWithRecovery } from '../io/atomic-file'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import type { ProjectPipelineState } from '@shared/types'
import { isReviewCurrent } from '../engine/artifact-provenance'
import type { PipelineStage, ReviewStage, ReviewResult } from '@shared/types'
import { normalizeSavedProjectState } from '../engine/project-state'
import { getProjectByPath } from './project-service'
import { assertPathWithinProject } from '../security/access-control'
import { readRegularFile } from '../io/atomic-file'
import { isMissingFileError } from '../security/access-control'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import { getExecutionLease } from './batch-execution-lease'

export async function getProjectPipelineState(
  projectPath: string
): Promise<ProjectPipelineState | null> {
  const project = getProjectByPath(projectPath)
  const statePath = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, 'pipelineState', project?.config)
  )
  const state = await readJsonWithRecovery<ProjectPipelineState>(statePath, {
    readOnly: true
  })
  if (!state) return null
  normalizeSavedProjectState(state, projectPath, project?.id || state.projectId)
  if (!state.episodes || typeof state.episodes !== 'object')
    throw new Error('项目流水线状态格式损坏')
  for (const episode of Object.values(state.episodes)) {
    const fileReviews: ReviewResult[] = []
    for (const [stage, artifact] of [
      ['script_review', 'scriptReview'],
      ['story_review', 'storyReview'],
      ['storyboard_review', 'storyboardReview']
    ] as const) {
      const path = assertPathWithinProject(
        projectPath,
        resolveEpisodeArtifactPath(
          projectPath,
          artifact,
          episode.episodeNum,
          project?.config
        )
      )
      try {
        const review = parseReviewMarkdown(
          (await readRegularFile(path)).toString('utf8'),
          stage
        )
        if (review) fileReviews.push(review)
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    }
    const reviews = episode.reviews || []
    const findReview = (stage: ReviewStage): ReviewResult | undefined => {
      const matchingFile = fileReviews.find((review) => review.stage === stage)
      if (matchingFile) return matchingFile
      const matching = Object.values(episode.stageStates || {}).find(
        (snapshot) => snapshot?.lastReview?.stage === stage
      )?.lastReview
      return (
        matching ||
        [...reviews].reverse().find((review) => review.stage === stage)
      )
    }
    const current = (stage: ReviewStage) => {
      const review = findReview(stage)
      return (
        !!review?.passed &&
        isReviewCurrent(
          review,
          projectPath,
          episode.episodeNum,
          project?.config
        )
      )
    }
    const scriptApproved = current('script_review')
    const directorApproved = scriptApproved && current('director')
    const artApproved = directorApproved && current('art')
    const storyboardApproved = artApproved && current('storyboard_review')
    const valid: Partial<Record<PipelineStage, boolean>> = {
      story: current('story_review'),
      story_review: current('story_review'),
      script: scriptApproved,
      script_review: scriptApproved,
      director: directorApproved,
      art: artApproved,
      character: artApproved,
      storyboard: storyboardApproved,
      storyboard_review: storyboardApproved
    }
    for (const [key, snapshot] of Object.entries(episode.stageStates || {})) {
      if (snapshot?.status === 'running' && !getExecutionLease())
        snapshot.status = 'interrupted'
      if (
        snapshot &&
        ['passed', 'skipped'].includes(snapshot.status) &&
        !valid[key as PipelineStage]
      ) {
        snapshot.status = 'stale'
      }
    }
    const previousCompleted = episode.completedStages || []
    episode.completedStages = previousCompleted.filter(
      (stage) => valid[stage] === true
    )
    if (
      previousCompleted.length !== episode.completedStages.length ||
      episode.status === 'complete'
    ) {
      episode.status = storyboardApproved
        ? 'complete'
        : artApproved
          ? 'art'
          : directorApproved
            ? 'director'
            : scriptApproved
              ? 'script_review'
              : 'idle'
    }
  }
  return state
}
