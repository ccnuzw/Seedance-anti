import { getDatabase } from './database'
import {
  getProject,
  getProjectTotalEpisodes,
  updateProjectEpisodeCount
} from './project-repository'
import type { Episode } from '@shared/types'
import type { EpisodeScanResult, ProjectScanResult } from '../project-sync/scan'
import { mapEpisode } from './episode-row-mapper'
import {
  applyEpisodeSnapshot,
  insertEpisodeSnapshot,
  isEpisodeSnapshotChanged
} from './episode-sync-helpers'
import { runProjectSyncWorker } from './episode-sync-worker'
import { assertEpisodeNumber } from '../security/access-control'

const projectSyncs = new Map<
  string,
  { totalEpisodes: number; promise: Promise<ProjectScanResult> }
>()
const episodeSyncs = new Map<string, Promise<Episode | null>>()

function getEpisodeRows(projectId: string): Record<string, unknown>[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_number'
    )
    .all(projectId) as Record<string, unknown>[]
}

function getEpisodeRow(
  projectId: string,
  episodeNumber: number
): Record<string, unknown> | undefined {
  return getDatabase()
    .prepare(
      'SELECT * FROM episodes WHERE project_id = ? AND episode_number = ?'
    )
    .get(projectId, episodeNumber) as Record<string, unknown> | undefined
}

function createEpisodeInsertStatement() {
  return getDatabase().prepare(`
    INSERT OR IGNORE INTO episodes (id, project_id, episode_number, title, status, story_beat_path, story_review_path, script_path, script_review_path, director_analysis_path, character_design_path, art_design_path, storyboard_path, seedance_prompts_path, storyboard_review_path, has_story_beat, has_story_review, has_script, has_script_review, has_director, has_character, has_art, has_storyboard, has_prompts, has_storyboard_review, total_prompts, total_duration_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
}

function refreshEpisodeRows(
  rows: Record<string, unknown>[],
  snapshots: Map<number, EpisodeScanResult>,
  now: string
): void {
  const db = getDatabase()
  const update = db.prepare(`
    UPDATE episodes SET
      status = ?, story_beat_path = ?, story_review_path = ?, script_path = ?, script_review_path = ?, director_analysis_path = ?, character_design_path = ?, art_design_path = ?, storyboard_path = ?, seedance_prompts_path = ?, storyboard_review_path = ?,
      has_story_beat = ?, has_story_review = ?, has_script = ?, has_script_review = ?, has_director = ?, has_character = ?, has_art = ?, has_storyboard = ?, has_prompts = ?, has_storyboard_review = ?,
      total_prompts = ?, total_duration_seconds = ?, updated_at = ?
    WHERE id = ?
  `)
  db.transaction(() => {
    for (const row of rows) {
      const snapshot = snapshots.get(row.episode_number as number)
      if (snapshot && isEpisodeSnapshotChanged(row, snapshot)) {
        applyEpisodeSnapshot(update, row.id as string, snapshot, now)
      }
    }
  })()
}

export function syncEpisodesFromFilesystem(
  projectId: string,
  projectPath: string,
  totalEpisodes: number
): Promise<ProjectScanResult> {
  const key = JSON.stringify([projectId, projectPath])
  const active = projectSyncs.get(key)
  if (active) {
    if (totalEpisodes <= active.totalEpisodes) return active.promise
    return active.promise.then(() =>
      syncEpisodesFromFilesystem(projectId, projectPath, totalEpisodes)
    )
  }
  const sync = (async () => {
    const project = getProject(projectId)
    const existing = getEpisodeRows(projectId)
    const plannedTotal = Math.max(
      totalEpisodes,
      project?.totalEpisodes || 0,
      ...existing.map((row) => Number(row.episode_number))
    )
    const result = await runProjectSyncWorker<ProjectScanResult>({
      mode: 'project',
      projectPath,
      config: project?.config,
      totalEpisodes: plannedTotal
    })
    const db = getDatabase()
    const insert = createEpisodeInsertStatement()
    const now = new Date().toISOString()
    db.transaction(() => {
      // A missing file is not a business deletion. Keep IDs and all related
      // reviews, asset references and execution history for every planned row.
      for (const snapshot of result.episodes)
        insertEpisodeSnapshot(insert, projectId, snapshot, now)
      const nextTotal = Math.max(plannedTotal, ...result.episodeNumbers)
      if (nextTotal > getProjectTotalEpisodes(projectId))
        updateProjectEpisodeCount(projectId, nextTotal)
    })()
    return result
  })()
  projectSyncs.set(key, { totalEpisodes, promise: sync })
  void sync
    .finally(() => {
      if (projectSyncs.get(key)?.promise === sync) projectSyncs.delete(key)
    })
    .catch(() => {})
  return sync
}

export async function syncEpisodeStatus(
  projectId: string,
  projectPath: string
): Promise<Episode[]> {
  const result = await syncEpisodesFromFilesystem(
    projectId,
    projectPath,
    getProjectTotalEpisodes(projectId)
  )
  refreshEpisodeRows(
    getEpisodeRows(projectId),
    new Map(
      result.episodes.map((snapshot) => [snapshot.episodeNumber, snapshot])
    ),
    new Date().toISOString()
  )
  return getEpisodeRows(projectId).map(mapEpisode)
}

export function syncSingleEpisodeStatus(
  projectId: string,
  projectPath: string,
  episodeNumber: number
): Promise<Episode | null> {
  assertEpisodeNumber(episodeNumber)
  const projectKey = JSON.stringify([projectId, projectPath])
  const key = JSON.stringify([projectId, projectPath, episodeNumber])
  const active = episodeSyncs.get(key)
  if (active) return active
  const sync = (async () => {
    const fullSync = projectSyncs.get(projectKey)
    let snapshot: EpisodeScanResult | undefined
    if (fullSync)
      snapshot = (await fullSync.promise).episodes.find(
        (episode) => episode.episodeNumber === episodeNumber
      )
    if (!snapshot) {
      const project = getProject(projectId)
      snapshot = (
        await runProjectSyncWorker<{ episode: EpisodeScanResult }>({
          mode: 'episode',
          projectPath,
          config: project?.config,
          totalEpisodes: project?.totalEpisodes || 0,
          episodeNumber
        })
      ).episode
    }
    const now = new Date().toISOString()
    insertEpisodeSnapshot(
      createEpisodeInsertStatement(),
      projectId,
      snapshot,
      now
    )
    const row = getEpisodeRow(projectId, episodeNumber)
    if (!row) return null
    refreshEpisodeRows([row], new Map([[episodeNumber, snapshot]]), now)
    const latest = getEpisodeRow(projectId, episodeNumber)
    return latest ? mapEpisode(latest) : null
  })()
  episodeSyncs.set(key, sync)
  void sync
    .finally(() => {
      if (episodeSyncs.get(key) === sync) episodeSyncs.delete(key)
    })
    .catch(() => {})
  return sync
}
