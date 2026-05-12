import { v4 as uuid } from 'uuid'
import { getDatabase } from './database'
import type { Episode, EpisodeStatus } from '@shared/types'
import { mapEpisode } from './episode-row-mapper'
export {
  syncEpisodeStatus,
  syncEpisodesFromFilesystem,
  syncSingleEpisodeStatus
} from './episode-sync-repository'

const EPISODE_SELECT_COLUMNS = `
  id,
  project_id,
  episode_number,
  title,
  status,
  story_beat_path,
  story_review_path,
  script_path,
  script_review_path,
  director_analysis_path,
  character_design_path,
  art_design_path,
  storyboard_path,
  seedance_prompts_path,
  storyboard_review_path,
  has_story_beat,
  has_story_review,
  has_script,
  has_script_review,
  has_director,
  has_character,
  has_art,
  has_storyboard,
  has_prompts,
  has_storyboard_review,
  total_duration_seconds,
  total_prompts,
  created_at,
  updated_at
`

export function createEpisode(data: {
  projectId: string
  episodeNumber: number
  title?: string
  scriptPath?: string
}): Episode {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()

  db.prepare(
    `
    INSERT INTO episodes (id, project_id, episode_number, title, script_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    data.projectId,
    data.episodeNumber,
    data.title || null,
    data.scriptPath || null,
    now,
    now
  )

  return getEpisode(id)!
}

export function getEpisode(id: string): Episode | null {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT ${EPISODE_SELECT_COLUMNS} FROM episodes WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return mapEpisode(row)
}

export function listEpisodes(projectId: string): Episode[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT ${EPISODE_SELECT_COLUMNS} FROM episodes WHERE project_id = ? ORDER BY episode_number`
    )
    .all(projectId) as Record<string, unknown>[]
  return rows.map(mapEpisode)
}

export function updateEpisodeStatus(id: string, status: EpisodeStatus): void {
  const db = getDatabase()
  db.prepare('UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    id
  )
}
