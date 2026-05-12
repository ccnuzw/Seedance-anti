import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { deriveEpisodeStatus } from '@shared/workflow'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import type { EpisodeStatus, Project, ReviewResult } from '@shared/types'

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
  const sourceNovelPath = resolveProjectArtifactPath(
    projectPath,
    'sourceNovel',
    config
  )
  return existsSync(sourceNovelPath)
}

const reviewResultCache = new Map<
  string,
  {
    mtimeMs: number
    result: ReviewResult | null
  }
>()

const promptStatsCache = new Map<
  string,
  {
    mtimeMs: number
    totalPrompts: number
    totalDuration: number
  }
>()

function loadReviewResult(
  filePath: string,
  stage: 'story_review' | 'script_review' | 'storyboard_review'
): ReviewResult | null {
  try {
    const stat = statSync(filePath)
    const cached = reviewResultCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.result
    }
    const raw = readFileSync(filePath, 'utf-8')
    const result = parseReviewMarkdown(raw, stage)
    reviewResultCache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      result
    })
    return result
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
    const stat = statSync(filePath)
    const cached = promptStatsCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return {
        totalPrompts: cached.totalPrompts,
        totalDuration: cached.totalDuration
      }
    }

    const raw = readFileSync(filePath, 'utf-8')
    const sections = raw.split(/^## /m).slice(1)
    const totalPrompts = sections.filter((s) => s.trim().length > 0).length
    let totalDuration = 0
    for (const section of sections) {
      const durMatch =
        section.match(/时长[：:]\s*(\d+)\s*[秒s]/i) ||
        section.match(/建议时长[：:]\s*(\d+)/i) ||
        section.match(/(\d+)\s*[秒s]/i)
      if (durMatch) totalDuration += parseInt(durMatch[1])
    }

    promptStatsCache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      totalPrompts,
      totalDuration
    })

    return { totalPrompts, totalDuration }
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
  const storyBeatPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyBeat',
    episodeNumber,
    config
  )
  const scriptPath = resolveEpisodeArtifactPath(
    projectPath,
    'script',
    episodeNumber,
    config
  )
  const storyReviewPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyReview',
    episodeNumber,
    config
  )
  const scriptReviewPath = resolveEpisodeArtifactPath(
    projectPath,
    'scriptReview',
    episodeNumber,
    config
  )
  const directorPath = resolveEpisodeArtifactPath(
    projectPath,
    'directorAnalysis',
    episodeNumber,
    config
  )
  const characterPath = resolveEpisodeArtifactPath(
    projectPath,
    'characterDesign',
    episodeNumber,
    config
  )
  const artPath = resolveEpisodeArtifactPath(
    projectPath,
    'artDesign',
    episodeNumber,
    config
  )
  const storyboardPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyboard',
    episodeNumber,
    config
  )
  const promptsPath = resolveEpisodeArtifactPath(
    projectPath,
    'seedancePrompts',
    episodeNumber,
    config
  )
  const storyboardReviewPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyboardReview',
    episodeNumber,
    config
  )

  const hasStoryBeat = existsSync(storyBeatPath)
  const storyReview = existsSync(storyReviewPath)
    ? loadReviewResult(storyReviewPath, 'story_review')
    : null
  const hasStoryReview = !!storyReview?.passed
  const hasScript = existsSync(scriptPath)
  const scriptReview = existsSync(scriptReviewPath)
    ? loadReviewResult(scriptReviewPath, 'script_review')
    : null
  const hasScriptReview = !!scriptReview?.passed
  const hasDirector = existsSync(directorPath)
  const hasCharacter = existsSync(characterPath)
  const hasArt = existsSync(artPath)
  const hasStoryboard = existsSync(storyboardPath)
  const hasPrompts = existsSync(promptsPath)
  const storyboardReview = existsSync(storyboardReviewPath)
    ? loadReviewResult(storyboardReviewPath, 'storyboard_review')
    : null
  const hasStoryboardReview = !!storyboardReview?.passed
  const promptStats = hasPrompts
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
    directorAnalysisPath: hasDirector ? directorPath : null,
    characterDesignPath: hasCharacter ? characterPath : null,
    artDesignPath: hasArt ? artPath : null,
    storyboardPath: hasStoryboard ? storyboardPath : null,
    seedancePromptsPath: hasPrompts ? promptsPath : null,
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
  const outputsDir = join(projectPath, layout.outputsDir)
  const scriptDir = join(projectPath, layout.scriptDir)
  const storyDir = join(projectPath, layout.storyEpisodeBeatsDir)
  const hasSourceNovel = hasProjectSourceNovel(projectPath, config)

  const episodeNums = new Set<number>()

  if (existsSync(outputsDir)) {
    for (const entry of readdirSync(outputsDir)) {
      const match = entry.match(/^ep(\d+)$/)
      if (match) episodeNums.add(parseInt(match[1]))
    }
  }

  if (existsSync(scriptDir)) {
    for (const entry of readdirSync(scriptDir)) {
      const match = entry.match(/^ep(\d+)\.md$/)
      if (match) episodeNums.add(parseInt(match[1]))
    }
  }

  if (existsSync(storyDir)) {
    for (const entry of readdirSync(storyDir)) {
      const match = entry.match(/^ep(\d+)\.md$/)
      if (match) episodeNums.add(parseInt(match[1]))
    }
  }

  if (episodeNums.size === 0 && totalEpisodes > 0) {
    for (let i = 1; i <= totalEpisodes; i++) episodeNums.add(i)
  }

  const sortedNums = [...episodeNums].sort((a, b) => a - b)
  const episodes = sortedNums.map((episodeNumber) =>
    scanEpisodeFilesystem(projectPath, config, episodeNumber, hasSourceNovel)
  )

  return {
    hasSourceNovel,
    episodeNumbers: sortedNums,
    episodes
  }
}
