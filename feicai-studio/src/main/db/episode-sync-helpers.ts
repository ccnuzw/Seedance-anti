import { v4 as uuid } from 'uuid'
import type Database from 'better-sqlite3'
import type { EpisodeScanResult } from '../project-sync/scan'

export interface SqlStatement {
  run: (...args: unknown[]) => unknown
}

export function insertEpisodeSnapshot(
  insertStmt: SqlStatement,
  projectId: string,
  snapshot: EpisodeScanResult,
  now: string
): void {
  insertStmt.run(
    uuid(),
    projectId,
    snapshot.episodeNumber,
    snapshot.title,
    snapshot.status,
    snapshot.storyBeatPath,
    snapshot.storyReviewPath,
    snapshot.scriptPath,
    snapshot.scriptReviewPath,
    snapshot.directorAnalysisPath,
    snapshot.characterDesignPath,
    snapshot.artDesignPath,
    snapshot.storyboardPath,
    snapshot.seedancePromptsPath,
    snapshot.storyboardReviewPath,
    snapshot.hasStoryBeat ? 1 : 0,
    snapshot.hasStoryReview ? 1 : 0,
    snapshot.hasScript ? 1 : 0,
    snapshot.hasScriptReview ? 1 : 0,
    snapshot.hasDirectorAnalysis ? 1 : 0,
    snapshot.hasCharacterDesign ? 1 : 0,
    snapshot.hasArtDesign ? 1 : 0,
    snapshot.hasStoryboard ? 1 : 0,
    snapshot.hasSeedancePrompts ? 1 : 0,
    snapshot.hasStoryboardReview ? 1 : 0,
    snapshot.totalPrompts,
    snapshot.totalDurationSeconds,
    now,
    now
  )
}

export function applyEpisodeSnapshot(
  updateStmt: SqlStatement,
  episodeId: string,
  snapshot: EpisodeScanResult,
  now: string
): void {
  updateStmt.run(
    snapshot.status,
    snapshot.storyBeatPath,
    snapshot.storyReviewPath,
    snapshot.scriptPath,
    snapshot.scriptReviewPath,
    snapshot.directorAnalysisPath,
    snapshot.characterDesignPath,
    snapshot.artDesignPath,
    snapshot.storyboardPath,
    snapshot.seedancePromptsPath,
    snapshot.storyboardReviewPath,
    snapshot.hasStoryBeat ? 1 : 0,
    snapshot.hasStoryReview ? 1 : 0,
    snapshot.hasScript ? 1 : 0,
    snapshot.hasScriptReview ? 1 : 0,
    snapshot.hasDirectorAnalysis ? 1 : 0,
    snapshot.hasCharacterDesign ? 1 : 0,
    snapshot.hasArtDesign ? 1 : 0,
    snapshot.hasStoryboard ? 1 : 0,
    snapshot.hasSeedancePrompts ? 1 : 0,
    snapshot.hasStoryboardReview ? 1 : 0,
    snapshot.totalPrompts,
    snapshot.totalDurationSeconds,
    now,
    episodeId
  )
}

export function deleteEpisodeRecord(
  db: Database.Database,
  episodeId: string
): void {
  db.prepare('DELETE FROM reviews WHERE episode_id = ?').run(episodeId)
  db.prepare('DELETE FROM asset_references WHERE episode_id = ?').run(episodeId)
  db.prepare('DELETE FROM execution_logs WHERE episode_id = ?').run(episodeId)
  db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId)
}

export function isEpisodeSnapshotChanged(
  row: Record<string, unknown>,
  snapshot: EpisodeScanResult
): boolean {
  return (
    row.status !== snapshot.status ||
    (row.story_beat_path ?? null) !== snapshot.storyBeatPath ||
    (row.story_review_path ?? null) !== snapshot.storyReviewPath ||
    (row.script_path ?? null) !== snapshot.scriptPath ||
    (row.script_review_path ?? null) !== snapshot.scriptReviewPath ||
    (row.director_analysis_path ?? null) !== snapshot.directorAnalysisPath ||
    (row.character_design_path ?? null) !== snapshot.characterDesignPath ||
    (row.art_design_path ?? null) !== snapshot.artDesignPath ||
    (row.storyboard_path ?? null) !== snapshot.storyboardPath ||
    (row.seedance_prompts_path ?? null) !== snapshot.seedancePromptsPath ||
    (row.storyboard_review_path ?? null) !== snapshot.storyboardReviewPath ||
    Number(row.has_story_beat ?? 0) !== (snapshot.hasStoryBeat ? 1 : 0) ||
    Number(row.has_story_review ?? 0) !== (snapshot.hasStoryReview ? 1 : 0) ||
    Number(row.has_script ?? 0) !== (snapshot.hasScript ? 1 : 0) ||
    Number(row.has_script_review ?? 0) !== (snapshot.hasScriptReview ? 1 : 0) ||
    Number(row.has_director ?? 0) !== (snapshot.hasDirectorAnalysis ? 1 : 0) ||
    Number(row.has_character ?? 0) !== (snapshot.hasCharacterDesign ? 1 : 0) ||
    Number(row.has_art ?? 0) !== (snapshot.hasArtDesign ? 1 : 0) ||
    Number(row.has_storyboard ?? 0) !== (snapshot.hasStoryboard ? 1 : 0) ||
    Number(row.has_prompts ?? 0) !== (snapshot.hasSeedancePrompts ? 1 : 0) ||
    Number(row.has_storyboard_review ?? 0) !==
      (snapshot.hasStoryboardReview ? 1 : 0) ||
    (row.total_prompts ?? null) !== snapshot.totalPrompts ||
    (row.total_duration_seconds ?? null) !== snapshot.totalDurationSeconds
  )
}
