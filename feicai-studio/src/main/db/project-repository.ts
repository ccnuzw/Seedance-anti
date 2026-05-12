import type Database from 'better-sqlite3'
import { getDatabase } from './database'
import { normalizeProjectConfig } from '@shared/workflow'
import type { Project } from '@shared/types'

const PROJECT_SELECT_COLUMNS = `
  id,
  name,
  visual_style,
  target_medium,
  project_path,
  total_episodes,
  config_json,
  created_at,
  updated_at
`

export function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    visualStyle: row.visual_style as string,
    targetMedium: row.target_medium as string,
    projectPath: row.project_path as string,
    totalEpisodes: row.total_episodes as number,
    config: row.config_json
      ? normalizeProjectConfig(JSON.parse(row.config_json as string))
      : normalizeProjectConfig(),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function getProject(id: string): Project | null {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT ${PROJECT_SELECT_COLUMNS} FROM projects WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return mapProject(row)
}

export function listProjects(): Project[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT ${PROJECT_SELECT_COLUMNS} FROM projects ORDER BY updated_at DESC`
    )
    .all() as Record<string, unknown>[]
  return rows.map(mapProject)
}

export function deleteProject(id: string): void {
  const db = getDatabase()
  const deleteReviewsStmt = db.prepare(`
    DELETE FROM reviews
    WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)
  `)
  const deleteAssetRefsStmt = db.prepare(`
    DELETE FROM asset_references
    WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)
  `)
  const deleteLogsStmt = db.prepare(`
    DELETE FROM execution_logs
    WHERE episode_id IN (SELECT id FROM episodes WHERE project_id = ?)
  `)
  const deleteEpisodesStmt = db.prepare(
    'DELETE FROM episodes WHERE project_id = ?'
  )
  const deleteCharactersStmt = db.prepare(
    'DELETE FROM characters WHERE project_id = ?'
  )
  const deleteScenesStmt = db.prepare('DELETE FROM scenes WHERE project_id = ?')
  const deleteProjectStmt = db.prepare('DELETE FROM projects WHERE id = ?')

  const runDelete = db.transaction((projectId: string) => {
    deleteReviewsStmt.run(projectId)
    deleteAssetRefsStmt.run(projectId)
    deleteLogsStmt.run(projectId)
    deleteEpisodesStmt.run(projectId)
    deleteCharactersStmt.run(projectId)
    deleteScenesStmt.run(projectId)
    deleteProjectStmt.run(projectId)
  })

  runDelete(id)
}

export function getProjectTotalEpisodes(projectId: string): number {
  const db = getDatabase()
  const row = db
    .prepare('SELECT total_episodes FROM projects WHERE id = ?')
    .get(projectId) as { total_episodes: number } | undefined
  return row?.total_episodes || 0
}

export function updateProjectEpisodeCount(
  projectId: string,
  totalEpisodes: number
): void {
  const db = getDatabase()
  db.prepare('UPDATE projects SET total_episodes = ? WHERE id = ?').run(
    totalEpisodes,
    projectId
  )
}

export function updateProjectRecordByPath(input: {
  projectPath: string
  name: string
  visualStyle: string
  targetMedium: string
  totalEpisodes: number
  configJson: string
  updatedAt: string
}): void {
  const db = getDatabase()
  db.prepare(
    `
    UPDATE projects
    SET name = ?, visual_style = ?, target_medium = ?, total_episodes = ?, config_json = ?, updated_at = ?
    WHERE project_path = ?
  `
  ).run(
    input.name,
    input.visualStyle,
    input.targetMedium,
    input.totalEpisodes,
    input.configJson,
    input.updatedAt,
    input.projectPath
  )
}

export function updateProjectRecord(input: {
  id: string
  name: string
  visualStyle: string
  targetMedium: string
  totalEpisodes: number
  configJson: string
  updatedAt: string
}): void {
  const db = getDatabase()
  db.prepare(
    `
    UPDATE projects
    SET name = ?, visual_style = ?, target_medium = ?, total_episodes = ?, config_json = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(
    input.name,
    input.visualStyle,
    input.targetMedium,
    input.totalEpisodes,
    input.configJson,
    input.updatedAt,
    input.id
  )
}

export function insertProjectRecord(
  db: Database.Database,
  input: {
    id: string
    name: string
    visualStyle: string
    targetMedium: string
    projectPath: string
    totalEpisodes: number
    configJson: string
    createdAt: string
    updatedAt: string
  }
): void {
  db.prepare(
    `
    INSERT INTO projects (id, name, visual_style, target_medium, project_path, total_episodes, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    input.id,
    input.name,
    input.visualStyle,
    input.targetMedium,
    input.projectPath,
    input.totalEpisodes,
    input.configJson,
    input.createdAt,
    input.updatedAt
  )
}
