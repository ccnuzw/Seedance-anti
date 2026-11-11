import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, sep } from 'path'
import { deriveEpisodeStatus } from '@shared/workflow'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import type {
  EpisodeStatus,
  Project,
  ProjectPipelineState,
  ReviewResult
} from '@shared/types'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import { isReviewCurrent } from '../engine/artifact-provenance'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'

export interface EpisodeScanResult {
  episodeNumber: number
  title: string
  status: EpisodeStatus
  storyBeatPath: string | null
  storyReviewPath: string | null
  scriptPath: string | null
  scriptReviewPath: string | null
  directorAnalysisPath: string | null
  characterDesignPath: string | null
  artDesignPath: string | null
  storyboardPath: string | null
  seedancePromptsPath: string | null
  storyboardReviewPath: string | null
  hasStoryBeat: boolean
  hasStoryReview: boolean
  hasScript: boolean
  hasScriptReview: boolean
  hasDirectorAnalysis: boolean
  hasCharacterDesign: boolean
  hasArtDesign: boolean
  hasStoryboard: boolean
  hasSeedancePrompts: boolean
  hasStoryboardReview: boolean
  totalPrompts: number | null
  totalDurationSeconds: number | null
}

export interface ProjectScanResult {
  hasSourceNovel: boolean
  episodeNumbers: number[]
  episodes: EpisodeScanResult[]
}

export function hasProjectSourceNovel(
  projectPath: string,
  config: Project['config'] | undefined
): boolean {
  const sourceNovelPath = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, 'sourceNovel', config)
  )
  return existsSync(sourceNovelPath)
}

const MAX_SCAN_CACHE_ENTRIES = 256
interface FileCacheEntry<T> {
  signature: string
  value: T
}
const reviewResultCache = new Map<string, FileCacheEntry<ReviewResult | null>>()
const promptStatsCache = new Map<
  string,
  FileCacheEntry<{
    totalPrompts: number
    totalDuration: number
  }>
>()
const stateCache = new Map<
  string,
  FileCacheEntry<ProjectPipelineState | null>
>()
export function invalidateProjectScanCache(projectPath?: string): void {
  if (projectPath)
    projectPath = assertPathWithinProject(projectPath, projectPath)
  for (const cache of [reviewResultCache, promptStatsCache, stateCache]) {
    for (const path of cache.keys()) {
      if (
        !projectPath ||
        path === projectPath ||
        path.startsWith(`${projectPath}${sep}`)
      )
        cache.delete(path)
    }
  }
}

function readCached<T>(
  filePath: string,
  cache: Map<string, FileCacheEntry<T>>,
  load: () => T
): T {
  const stat = statSync(filePath)
  const signature = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
  const cached = cache.get(filePath)
  if (cached?.signature === signature) {
    cache.delete(filePath)
    cache.set(filePath, cached)
    return cached.value
  }
  const value = load()
  cache.delete(filePath)
  cache.set(filePath, { signature, value })
  if (cache.size > MAX_SCAN_CACHE_ENTRIES)
    cache.delete(cache.keys().next().value!)
  return value
}

function loadPipelineState(filePath: string): ProjectPipelineState | null {
  try {
    return readCached(
      filePath,
      stateCache,
      () => JSON.parse(readFileSync(filePath, 'utf-8')) as ProjectPipelineState
    )
  } catch {
    stateCache.delete(filePath)
    return null
  }
}

function loadReviewResult(
  filePath: string,
  stage: 'story_review' | 'script_review' | 'storyboard_review'
): ReviewResult | null {
  try {
    return readCached(filePath, reviewResultCache, () =>
      parseReviewMarkdown(readFileSync(filePath, 'utf-8'), stage)
    )
  } catch {
    reviewResultCache.delete(filePath)
    return null
  }
}

function loadPromptStats(filePath: string): {
  totalPrompts: number
  totalDuration: number
} {
  try {
    return readCached(filePath, promptStatsCache, () => {
      const sections = readFileSync(filePath, 'utf-8').split(/^## /m).slice(1)
      const totalPrompts = sections.filter((s) => s.trim().length > 0).length
      let totalDuration = 0
      for (const section of sections) {
        const match =
          section.match(/时长[：:]\s*(\d+)\s*[秒s]/i) ||
          section.match(/建议时长[：:]\s*(\d+)/i) ||
          section.match(/(\d+)\s*[秒s]/i)
        if (match) totalDuration += Number(match[1])
      }
      return { totalPrompts, totalDuration }
    })
  } catch {
    promptStatsCache.delete(filePath)
    return { totalPrompts: 0, totalDuration: 0 }
  }
}

export function scanEpisodeFilesystem(
  projectPath: string,
  config: Project['config'] | undefined,
  episodeNumber: number,
  hasSourceNovel: boolean
): EpisodeScanResult {
  assertEpisodeNumber(episodeNumber)
  const artifactPath = (artifact: EpisodeArtifactId): string =>
    assertPathWithinProject(
      projectPath,
      resolveEpisodeArtifactPath(projectPath, artifact, episodeNumber, config)
    )
  const storyBeatPath = artifactPath('storyBeat')
  const scriptPath = artifactPath('script')
  const storyReviewPath = artifactPath('storyReview')
  const scriptReviewPath = artifactPath('scriptReview')
  const directorPath = artifactPath('directorAnalysis')
  const characterPath = artifactPath('characterDesign')
  const artPath = artifactPath('artDesign')
  const storyboardPath = artifactPath('storyboard')
  const promptsPath = artifactPath('seedancePrompts')
  const storyboardReviewPath = artifactPath('storyboardReview')
  const current = (review: ReviewResult | null | undefined): boolean =>
    !!review?.passed &&
    review.result === 'PASS' &&
    isReviewCurrent(review, projectPath, episodeNumber, config)

  const hasStoryBeat = existsSync(storyBeatPath)
  const storyReview = existsSync(storyReviewPath)
    ? loadReviewResult(storyReviewPath, 'story_review')
    : null
  const hasStoryReview = current(storyReview)
  const hasScript = existsSync(scriptPath)
  const scriptReview = existsSync(scriptReviewPath)
    ? loadReviewResult(scriptReviewPath, 'script_review')
    : null
  const hasScriptReview = hasScript && current(scriptReview)
  const statePath = assertPathWithinProject(
    projectPath,
    resolveProjectArtifactPath(projectPath, 'pipelineState', config)
  )
  const state = existsSync(statePath)
    ? loadPipelineState(statePath)?.episodes?.[episodeNumber]
    : undefined
  const directorExists = existsSync(directorPath)
  const characterExists = existsSync(characterPath)
  const artExists = existsSync(artPath)
  const storyboardExists = existsSync(storyboardPath)
  const promptsExist = existsSync(promptsPath)
  // Physical paths stay available for editing/review. Completion flags require
  // current upstream approvals, not merely artifacts left by a previous run.
  const hasDirector = directorExists && hasScriptReview
  const directorApproved =
    hasDirector &&
    state?.stageStates?.director?.status === 'passed' &&
    current(state.stageStates.director.lastReview)
  const hasCharacter = characterExists && directorApproved
  const hasArt = artExists && directorApproved
  const artApproved =
    hasArt &&
    state?.stageStates?.art?.status === 'passed' &&
    current(state.stageStates.art.lastReview)
  const hasStoryboard = storyboardExists && artApproved
  const hasPrompts = promptsExist && artApproved
  const storyboardReview = existsSync(storyboardReviewPath)
    ? loadReviewResult(storyboardReviewPath, 'storyboard_review')
    : null
  const hasStoryboardReview = hasPrompts && current(storyboardReview)
  const promptStats = promptsExist
    ? loadPromptStats(promptsPath)
    : { totalPrompts: 0, totalDuration: 0 }

  const status = deriveEpisodeStatus({
    hasSourceNovel,
    hasStoryBeat,
    hasStoryReview,
    hasScript,
    hasScriptReview,
    hasDirectorAnalysis: hasDirector,
    hasCharacterDesign: hasCharacter,
    hasArtDesign: hasArt,
    hasStoryboard,
    hasSeedancePrompts: hasPrompts,
    hasStoryboardReview
  })

  return {
    episodeNumber,
    title: `第${episodeNumber}集`,
    status,
    storyBeatPath: hasStoryBeat ? storyBeatPath : null,
    storyReviewPath: storyReview ? storyReviewPath : null,
    scriptPath: hasScript ? scriptPath : null,
    scriptReviewPath: scriptReview ? scriptReviewPath : null,
    directorAnalysisPath: directorExists ? directorPath : null,
    characterDesignPath: characterExists ? characterPath : null,
    artDesignPath: artExists ? artPath : null,
    storyboardPath: storyboardExists ? storyboardPath : null,
    seedancePromptsPath: promptsExist ? promptsPath : null,
    storyboardReviewPath: storyboardReview ? storyboardReviewPath : null,
    hasStoryBeat,
    hasStoryReview,
    hasScript,
    hasScriptReview,
    hasDirectorAnalysis: hasDirector,
    hasCharacterDesign: hasCharacter,
    hasArtDesign: hasArt,
    hasStoryboard,
    hasSeedancePrompts: hasPrompts,
    hasStoryboardReview,
    totalPrompts:
      promptStats.totalPrompts > 0 ? promptStats.totalPrompts : null,
    totalDurationSeconds:
      promptStats.totalDuration > 0 ? promptStats.totalDuration : null
  }
}

export function scanProjectFilesystem(
  projectPath: string,
  config: Project['config'] | undefined,
  totalEpisodes: number
): ProjectScanResult {
  const layout = resolveProjectLayout(config)
  const outputsDir = assertPathWithinProject(
    projectPath,
    join(projectPath, layout.outputsDir)
  )
  const scriptDir = assertPathWithinProject(
    projectPath,
    join(projectPath, layout.scriptDir)
  )
  const storyDir = assertPathWithinProject(
    projectPath,
    join(projectPath, layout.storyEpisodeBeatsDir)
  )
  const hasSourceNovel = hasProjectSourceNovel(projectPath, config)
  const episodeNums = new Set<number>()
  for (let i = 1; i <= Math.min(totalEpisodes, 10000); i++) episodeNums.add(i)

  for (const [directory, pattern] of [
    [outputsDir, /^ep(\d+)$/],
    [scriptDir, /^ep(\d+)\.md$/],
    [storyDir, /^ep(\d+)\.md$/]
  ] as const) {
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory)) {
      const match = entry.match(pattern)
      if (!match) continue
      const number = Number(match[1])
      if (Number.isInteger(number) && number > 0 && number <= 10000)
        episodeNums.add(number)
    }
  }

  const episodeNumbers = [...episodeNums].sort((a, b) => a - b)
  return {
    hasSourceNovel,
    episodeNumbers,
    episodes: episodeNumbers.map((number) =>
      scanEpisodeFilesystem(projectPath, config, number, hasSourceNovel)
    )
  }
}
