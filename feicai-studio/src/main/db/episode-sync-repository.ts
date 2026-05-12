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
  deleteEpisodeRecord,
  insertEpisodeSnapshot,
  isEpisodeSnapshotChanged
} from './episode-sync-helpers'
import { runProjectSyncWorker } from './episode-sync-worker'

function getEpisodeRows(projectId: string): Record<string, unknown>[] {
  const db = getDatabase()
  return db
    .prepare(
      'SELECT * FROM episodes WHERE project_id = ? ORDER BY episode_number'
    )
    .all(projectId) as Record<string, unknown>[]
}

function getEpisodeRow(
  projectId: string,
  episodeNumber: number
): Record<string, unknown> | undefined {
  const db = getDatabase()
  return db
    .prepare(
      'SELECT * FROM episodes WHERE project_id = ? AND episode_number = ?'
    )
    .get(projectId, episodeNumber) as Record<string, unknown> | undefined
}

function createEpisodeUpdateStatement() {
  const db = getDatabase()
  return db.prepare(`
    UPDATE episodes SET
      status = ?, story_beat_path = ?, story_review_path = ?, script_path = ?, script_review_path = ?, director_analysis_path = ?, character_design_path = ?, art_design_path = ?, storyboard_path = ?, seedance_prompts_path = ?, storyboard_review_path = ?,
      has_story_beat = ?, has_story_review = ?, has_script = ?, has_script_review = ?, has_director = ?, has_character = ?, has_art = ?, has_storyboard = ?, has_prompts = ?, has_storyboard_review = ?,
      total_prompts = ?, total_duration_seconds = ?, updated_at = ?
    WHERE id = ?
  `)
}

async function scanProjectEpisodes(
  projectId: string,
  projectPath: string,
  totalEpisodes: number
): Promise<ProjectScanResult> {
  const project = getProject(projectId)
  return await runProjectSyncWorker<ProjectScanResult>({
    mode: 'project',
    projectPath,
    config: project?.config,
    totalEpisodes
  })
}

async function scanSingleEpisode(
  projectId: string,
  projectPath: string,
  episodeNumber: number
): Promise<EpisodeScanResult> {
  const project = getProject(projectId)
  return (
    await runProjectSyncWorker<{ episode: EpisodeScanResult }>({
      mode: 'episode',
      projectPath,
      config: project?.config,
      totalEpisodes: project?.totalEpisodes || 0,
      episodeNumber
    })
  ).episode
}

function refreshEpisodeRows(
  rows: Record<string, unknown>[],
  episodeSnapshots: Map<number, EpisodeScanResult>,
  now: string
): void {
  const db = getDatabase()
  const updateStmt = createEpisodeUpdateStatement()

  const runRefresh = db.transaction(() => {
    for (const row of rows) {
      const snapshot = episodeSnapshots.get(row.episode_number as number)
      if (!snapshot) continue
      if (!isEpisodeSnapshotChanged(row, snapshot)) continue
      applyEpisodeSnapshot(updateStmt, row.id as string, snapshot, now)
    }
  })

  runRefresh()
}

export async function syncEpisodesFromFilesystem(
  projectId: string,
  projectPath: string,
  totalEpisodes: number
): Promise<ProjectScanResult> {
  const db = getDatabase()
  const now = new Date().toISOString()
  const scanResult = await scanProjectEpisodes(
    projectId,
    projectPath,
    totalEpisodes
  )
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO episodes (id, project_id, episode_number, title, status, story_beat_path, story_review_path, script_path, script_review_path, director_analysis_path, character_design_path, art_design_path, storyboard_path, seedance_prompts_path, storyboard_review_path, has_story_beat, has_story_review, has_script, has_script_review, has_director, has_character, has_art, has_storyboard, has_prompts, has_storyboard_review, total_prompts, total_duration_seconds, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const existingEpisodesStmt = db.prepare(
    'SELECT id, episode_number FROM episodes WHERE project_id = ?'
  )

  const runSync = db.transaction(() => {
    const scannedEpisodeNumbers = new Set(scanResult.episodeNumbers)
    const existingEpisodes = existingEpisodesStmt.all(projectId) as Array<{
      id: string
      episode_number: number
    }>

    for (const row of existingEpisodes) {
      if (!scannedEpisodeNumbers.has(row.episode_number)) {
        deleteEpisodeRecord(db, row.id)
      }
    }

    for (const snapshot of scanResult.episodes) {
      insertEpisodeSnapshot(insertStmt, projectId, snapshot, now)
    }

    if (
      scanResult.episodeNumbers.length > 0 &&
      scanResult.episodeNumbers.length !== totalEpisodes
    ) {
      updateProjectEpisodeCount(projectId, scanResult.episodeNumbers.length)
    }
  })

  runSync()
  return scanResult
}

export async function syncEpisodeStatus(
  projectId: string,
  projectPath: string
): Promise<Episode[]> {
  const totalEpisodes = getProjectTotalEpisodes(projectId)
  const scanResult = await syncEpisodesFromFilesystem(
    projectId,
    projectPath,
    totalEpisodes
  )
  const episodeSnapshots = new Map(
    scanResult.episodes.map((snapshot) => [snapshot.episodeNumber, snapshot])
  )

  refreshEpisodeRows(
    getEpisodeRows(projectId),
    episodeSnapshots,
    new Date().toISOString()
  )

  return getEpisodeRows(projectId).map(mapEpisode)
}

export async function syncSingleEpisodeStatus(
  projectId: string,
  projectPath: string,
  episodeNumber: number
): Promise<Episode | null> {
  const project = getProject(projectId)
  const targetRow = getEpisodeRow(projectId, episodeNumber)

  if (!targetRow) {
    await syncEpisodesFromFilesystem(
      projectId,
      projectPath,
      project?.totalEpisodes || 0
    )
  }

  const refreshedRow = getEpisodeRow(projectId, episodeNumber)
  if (!refreshedRow) {
    return null
  }

  refreshEpisodeRows(
    [refreshedRow],
    new Map([
      [
        episodeNumber,
        await scanSingleEpisode(projectId, projectPath, episodeNumber)
      ]
    ]),
    new Date().toISOString()
  )

  const latestRow = getEpisodeRow(projectId, episodeNumber)
  return latestRow ? mapEpisode(latestRow) : null
}
