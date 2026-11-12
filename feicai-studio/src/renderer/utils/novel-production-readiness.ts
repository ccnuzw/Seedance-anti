import type { Episode } from '@shared/types'
import type { PlotBreakdownSummary } from '@shared/ipc-contracts'

export interface NovelReadinessInput {
  projectId?: string
  hasSource: boolean | null
  waterline: Pick<
    PlotBreakdownSummary,
    'readyEpisodeNumbers' | 'usedEpisodeNumbers'
  > | null
  episodeNumber: number
  episode?: Episode
}

export function getNovelProductionReadiness(input: NovelReadinessInput) {
  const { hasSource, waterline, episodeNumber, episode } = input
  if (hasSource === false)
    return {
      canStart: false,
      action: 'source',
      label: '录入小说原文',
      reason: '请先补齐小说原文。'
    } as const
  if (hasSource === null || !waterline)
    return {
      canStart: false,
      action: 'refresh',
      label: '刷新准备状态',
      reason: '准备状态尚未取得，请刷新重试。'
    } as const
  if (
    !episode ||
    episode.episodeNumber !== episodeNumber ||
    (input.projectId !== undefined && episode.projectId !== input.projectId)
  )
    return {
      canStart: false,
      action: 'refresh',
      label: '刷新集状态',
      reason: '尚未取得当前集状态，请刷新后继续。'
    } as const
  if (episode.hasScript || episode.scriptPath)
    return {
      canStart: false,
      action: 'script',
      label: episode.hasScriptReview ? '查看现有剧本' : '查看并审核剧本',
      reason: '本集已有剧本，请先查看或审核现有内容。'
    } as const
  if (
    waterline.usedEpisodeNumbers.includes(episodeNumber) &&
    !episode?.hasScript
  )
    return {
      canStart: false,
      action: 'story',
      label: '核对已用剧情',
      reason: '本集剧情已使用但未找到剧本，请核对并恢复产物。'
    } as const
  if (
    waterline.readyEpisodeNumbers.includes(episodeNumber) &&
    !waterline.usedEpisodeNumbers.includes(episodeNumber)
  )
    return {
      canStart: true,
      action: 'script',
      label: '生成本集剧本',
      reason: '本集已有可用剧情，可生成剧本。'
    } as const
  return {
    canStart: false,
    action: 'story',
    label: episode?.hasStoryBeat ? '检查并审核剧情草稿' : '准备剧情草稿',
    reason: episode?.hasStoryBeat
      ? '尚无本集可用剧情，请检查草稿并审核入库。'
      : '尚无本集可用剧情，请先准备剧情草稿。'
  } as const
}
export type NovelProductionReadiness = ReturnType<
  typeof getNovelProductionReadiness
>
