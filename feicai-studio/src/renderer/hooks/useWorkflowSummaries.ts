import { useEffect, useState } from 'react'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import type { Episode, Project } from '@shared/types'
import { readCachedTextFile } from '@renderer/services/file-cache'
import {
  buildWorkflowSummaries,
  type WorkflowArtifactTexts
} from '@renderer/utils/pipeline-workflow-summaries'
import type { WorkflowSummaryMap } from '@renderer/utils/pipeline-view'

interface WorkflowSummaryCacheEntry {
  hasSourceNovel: boolean
  workflowSummaries: WorkflowSummaryMap
}

const workflowSummaryCache = new Map<string, WorkflowSummaryCacheEntry>()

function buildWorkflowSummaryCacheKey(params: {
  projectPath: string
  projectUpdatedAt?: string
  episodeNum: number
  episodeUpdatedAt?: string
  totalPrompts?: number
  totalDurationSeconds?: number
}): string {
  return [
    params.projectPath,
    params.projectUpdatedAt || '',
    params.episodeNum,
    params.episodeUpdatedAt || '',
    params.totalPrompts ?? '',
    params.totalDurationSeconds ?? ''
  ].join('::')
}

export function useWorkflowSummaries(
  currentProject: Project | null,
  currentEpisode: Episode | undefined,
  episodeNum: number
) {
  const [hasSourceNovel, setHasSourceNovel] = useState(false)
  const [workflowSummaries, setWorkflowSummaries] =
    useState<WorkflowSummaryMap>({})
  const projectPath = currentProject?.projectPath || ''
  const projectConfig = currentProject?.config
  const cacheKey = currentProject
    ? buildWorkflowSummaryCacheKey({
        projectPath,
        projectUpdatedAt: currentProject.updatedAt,
        episodeNum,
        episodeUpdatedAt: currentEpisode?.updatedAt,
        totalPrompts: currentEpisode?.totalPrompts,
        totalDurationSeconds: currentEpisode?.totalDurationSeconds
      })
    : ''

  useEffect(() => {
    if (!currentProject) {
      setHasSourceNovel(false)
      setWorkflowSummaries({})
      return
    }

    const cached = workflowSummaryCache.get(cacheKey)
    if (cached) {
      setHasSourceNovel(cached.hasSourceNovel)
      setWorkflowSummaries(cached.workflowSummaries)
      return
    }

    let cancelled = false

    ;(async () => {
      const [
        novelRaw,
        storyRaw,
        storyReviewRaw,
        scriptRaw,
        scriptReviewRaw,
        directorRaw,
        characterRaw,
        artRaw,
        promptsRaw,
        storyboardReviewRaw
      ] = await Promise.all([
        readCachedTextFile(
          resolveProjectArtifactPath(projectPath, 'sourceNovel', projectConfig)
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'storyBeat',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'storyReview',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'script',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'scriptReview',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'directorAnalysis',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'characterDesign',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'artDesign',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'seedancePrompts',
            episodeNum,
            projectConfig
          )
        ),
        readCachedTextFile(
          resolveEpisodeArtifactPath(
            projectPath,
            'storyboardReview',
            episodeNum,
            projectConfig
          )
        )
      ])

      if (cancelled) return

      const result = buildWorkflowSummaries(
        {
          novelRaw,
          storyRaw,
          storyReviewRaw,
          scriptRaw,
          scriptReviewRaw,
          directorRaw,
          characterRaw,
          artRaw,
          promptsRaw,
          storyboardReviewRaw
        } satisfies WorkflowArtifactTexts,
        currentEpisode
      )

      workflowSummaryCache.set(cacheKey, {
        hasSourceNovel: result.hasSourceNovel,
        workflowSummaries: result.summaryMap
      })
      setHasSourceNovel(result.hasSourceNovel)
      setWorkflowSummaries(result.summaryMap)
    })()

    return () => {
      cancelled = true
    }
  }, [
    projectPath,
    projectConfig,
    currentProject?.updatedAt,
    currentEpisode?.updatedAt,
    currentEpisode?.totalPrompts,
    currentEpisode?.totalDurationSeconds,
    episodeNum,
    cacheKey
  ])

  return {
    hasSourceNovel,
    workflowSummaries
  }
}
