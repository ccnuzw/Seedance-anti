import type { PlotBreakdownSummary } from '@shared/ipc-contracts'

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
