import type { ReviewResult, ReviewStage } from '@shared/types'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import { readCachedTextFile } from '@renderer/services/file-cache'

export function getReviewFilePath(
  projectPath: string,
  episodeNum: number,
  stage: ReviewStage
): string | null {
  if (stage === 'story_review') {
    return resolveEpisodeArtifactPath(projectPath, 'storyReview', episodeNum)
  }
  if (stage === 'script_review') {
    return resolveEpisodeArtifactPath(projectPath, 'scriptReview', episodeNum)
  }
  if (stage === 'storyboard_review') {
    return resolveEpisodeArtifactPath(
      projectPath,
      'storyboardReview',
      episodeNum
    )
  }
  return null
}

export async function loadLatestReviewFromFile(
  projectPath: string,
  episodeNum: number,
  stage: ReviewStage
): Promise<ReviewResult | null> {
  const filePath = getReviewFilePath(projectPath, episodeNum, stage)
  if (!filePath) return null

  const raw = await readCachedTextFile(filePath)
  if (!raw) return null
  return parseReviewMarkdown(raw, stage)
}

export function pickLatestReview(
  ...reviews: Array<ReviewResult | null | undefined>
): ReviewResult | null {
  const valid = reviews.filter(Boolean) as ReviewResult[]
  if (valid.length === 0) return null
  return valid.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]
}
