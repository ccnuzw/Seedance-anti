import type { Episode, EpisodeStatus } from './types'

export function isEpisodeComplete(status: EpisodeStatus): boolean {
  return status === 'complete'
}

export function isEpisodePartial(status: EpisodeStatus): boolean {
  return !isEpisodeComplete(status) && status !== 'idle'
}

export function countCompletedEpisodes(episodes: Episode[]): number {
  return episodes.filter((ep) => isEpisodeComplete(ep.status)).length
}
