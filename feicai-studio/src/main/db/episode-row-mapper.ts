import type { Episode, EpisodeStatus } from '@shared/types'

export function mapEpisode(row: Record<string, unknown>): Episode {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    episodeNumber: row.episode_number as number,
    title: row.title as string,
    status: row.status as EpisodeStatus,
    storyBeatPath: row.story_beat_path as string | undefined,
    storyReviewPath: row.story_review_path as string | undefined,
    scriptPath: row.script_path as string | undefined,
    scriptReviewPath: row.script_review_path as string | undefined,
    directorAnalysisPath: row.director_analysis_path as string | undefined,
    characterDesignPath: row.character_design_path as string | undefined,
    artDesignPath: row.art_design_path as string | undefined,
    storyboardPath: row.storyboard_path as string | undefined,
    seedancePromptsPath: row.seedance_prompts_path as string | undefined,
    storyboardReviewPath: row.storyboard_review_path as string | undefined,
    hasStoryBeat: (row.has_story_beat as number) === 1,
    hasStoryReview: (row.has_story_review as number) === 1,
    hasScript: (row.has_script as number) === 1,
    hasScriptReview: (row.has_script_review as number) === 1,
    hasDirectorAnalysis: (row.has_director as number) === 1,
    hasCharacterDesign: (row.has_character as number) === 1,
    hasArtDesign: (row.has_art as number) === 1,
    hasStoryboard: (row.has_storyboard as number) === 1,
    hasSeedancePrompts: (row.has_prompts as number) === 1,
    hasStoryboardReview: (row.has_storyboard_review as number) === 1,
    totalDurationSeconds: row.total_duration_seconds as number | undefined,
    totalPrompts: row.total_prompts as number | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}
