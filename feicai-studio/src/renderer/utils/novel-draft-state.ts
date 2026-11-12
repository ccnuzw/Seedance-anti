import type { PlotBreakdownSummary } from '@shared/ipc-contracts'
import type { Episode } from '@shared/types'

/** Episode slots locate files; only the persisted marker identifies a novel batch. */
export function novelDraftState(
  content: string,
  summary: PlotBreakdownSummary | null
) {
  const value = Number(
    content.match(/<!--\s*feicai-story-batch:(\d+)\s*-->/u)?.[1]
  )
  const batch = Number.isSafeInteger(value) && value > 0 ? value : null
  return { batch, nextBatch: batch ?? summary?.nextBatchNumber ?? null }
}

export function novelReadyEpisode(
  summary: PlotBreakdownSummary | null,
  episodes: Episode[] | null,
  projectId: string
): number | null {
  if (!summary || !episodes) return null
  const own = episodes.filter((ep) => ep.projectId === projectId)
  return (
    summary.readyEpisodeNumbers.find(
      (n) =>
        !summary.usedEpisodeNumbers.includes(n) &&
        !own.some(
          (ep) => ep.episodeNumber === n && (ep.hasScript || ep.scriptPath)
        )
    ) ?? null
  )
}

export function novelNextAction(
  batch: number | null,
  passed: boolean,
  summary: PlotBreakdownSummary | null,
  ready: number | null
): 'review' | 'script' | 'generate' | 'next' | 'complete' {
  if (batch && !passed) return 'review'
  if (ready) return 'script'
  if (!batch)
    return summary?.unprocessedChapterCount === 0 ? 'complete' : 'generate'
  return summary &&
    (summary.unprocessedChapterCount ?? 0) > 0 &&
    summary.nextBatchNumber > batch
    ? 'next'
    : 'complete'
}
