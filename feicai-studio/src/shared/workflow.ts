import type { EpisodeStatus, WorkflowStageId } from './types'
import { WORKFLOW_STAGE_MAP } from './workflow-definition'
export { normalizeProjectConfig } from './project-config'
export {
  countCompletedEpisodes,
  isEpisodeComplete,
  isEpisodePartial
} from './episode-status'

export interface EpisodeArtifactFlags {
  hasSourceNovel?: boolean
  hasStoryBeat: boolean
  hasStoryReview?: boolean
  hasScript: boolean
  hasScriptReview: boolean
  hasDirectorAnalysis: boolean
  hasCharacterDesign: boolean
  hasArtDesign: boolean
  hasStoryboard: boolean
  hasSeedancePrompts: boolean
  hasStoryboardReview: boolean
}

export interface WorkflowStageMeta {
  id: WorkflowStageId
  label: string
  shortLabel: string
  progress: number
  done: boolean
}

export function deriveEpisodeStatus(
  flags: EpisodeArtifactFlags
): EpisodeStatus {
  if (flags.hasStoryboardReview || flags.hasSeedancePrompts) return 'complete'
  if (flags.hasStoryboard) return 'storyboard'
  if (flags.hasArtDesign) return 'art'
  if (flags.hasCharacterDesign) return 'character'
  if (flags.hasDirectorAnalysis) return 'director'
  if (flags.hasScriptReview) return 'script_approved'
  if (flags.hasScript) return 'script'
  if (flags.hasStoryReview) return 'story_review'
  if (flags.hasStoryBeat) return 'story'
  if (flags.hasSourceNovel) return 'novel'
  return 'idle'
}

export function getEpisodeStageMeta(status: EpisodeStatus): WorkflowStageMeta {
  if (status === 'idle') {
    return {
      id: 'novel',
      label: '待开始',
      shortLabel: '待开始',
      progress: 0,
      done: false
    }
  }
  const meta = WORKFLOW_STAGE_MAP[status]
  return { ...meta, done: status === 'complete' }
}

export function getEpisodeProgress(status: EpisodeStatus): number {
  return getEpisodeStageMeta(status).progress
}
