import { getEpisodeProgress, getEpisodeStageMeta } from '@shared/workflow'
import { isEpisodeComplete } from '@shared/episode-status'
import type { Episode, PipelineState, ProjectConfig } from '@shared/types'
import { mapEpisodeStatusToDisplayState } from './pipeline-view'

export function resolvePipelineDisplayState(params: {
  isEngineMatch: boolean
  engineState: PipelineState
  episodeStatus?: Episode['status']
}): PipelineState {
  const { isEngineMatch, engineState, episodeStatus } = params
  return isEngineMatch
    ? engineState
    : mapEpisodeStatusToDisplayState(episodeStatus)
}

export function resolvePipelineSummary(params: {
  projectConfig: ProjectConfig
  episode?: Episode
  automationGate: string
  automationReady: boolean
}) {
  const { projectConfig, episode, automationGate, automationReady } = params
  const stageMeta = getEpisodeStageMeta(episode?.status || 'idle')
  return {
    entryLabel:
      projectConfig.entryStage === 'novel'
        ? '从小说开始'
        : projectConfig.entryStage === 'story'
          ? '从剧情开始'
          : '从剧本开始',
    workflowMode: projectConfig.workflowMode,
    currentStageLabel: stageMeta.label,
    progress: getEpisodeProgress(episode?.status || 'idle'),
    automationGate,
    automationReady
  }
}

export function shouldShowCompleteBanner(episode?: Episode): boolean {
  return isEpisodeComplete(episode?.status || 'idle')
}
