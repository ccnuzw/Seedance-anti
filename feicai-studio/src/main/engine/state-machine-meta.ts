import { deriveEpisodeStatus } from '@shared/workflow'
import type { AutomatedPipelineStage, PipelineState } from '@shared/types'

export interface StageStateDefinition {
  executing: PipelineState
  reviewing: PipelineState
  done: PipelineState
}

export const PIPELINE_STAGE_STATES: Record<
  AutomatedPipelineStage,
  StageStateDefinition
> = {
  director: {
    executing: 'director_analyzing',
    reviewing: 'director_reviewing',
    done: 'director_done'
  },
  art: {
    executing: 'art_designing',
    reviewing: 'art_reviewing',
    done: 'art_done'
  },
  storyboard: {
    executing: 'storyboard_writing',
    reviewing: 'storyboard_reviewing',
    done: 'episode_complete'
  }
}

export const PIPELINE_STAGE_ORDER: AutomatedPipelineStage[] = [
  'director',
  'art',
  'storyboard'
]

export const PIPELINE_TERMINAL_STATES: PipelineState[] = [
  'idle',
  'episode_complete',
  'error',
  'paused'
]

export function getPipelineStageName(stage: AutomatedPipelineStage): string {
  return {
    director: '导演分析',
    art: '服化道设计',
    storyboard: '分镜编写'
  }[stage]
}

export function deriveEpisodeStatusFromStage(stage: AutomatedPipelineStage) {
  return deriveEpisodeStatus({
    hasStoryBeat: false,
    hasScript: true,
    hasScriptReview: true,
    hasDirectorAnalysis:
      stage === 'director' || stage === 'art' || stage === 'storyboard',
    hasCharacterDesign: false,
    hasArtDesign: stage === 'art' || stage === 'storyboard',
    hasStoryboard: false,
    hasSeedancePrompts: stage === 'storyboard',
    hasStoryboardReview: false
  })
}
