import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { AdaptPlan, EpisodeStatus } from '@shared/types'
import { ensureProjectDataFileSync } from './project-data-compat'
import {
  getWritableScriptEpisodePath,
  listScriptEpisodeFiles
} from './script-file-utils'

const DIRECTOR_FILE = '01-director-analysis.md'
const ART_FILE = '01.5-art-design-output.md'
const PROMPTS_FILE = '02-seedance-prompts.md'

export interface EpisodeProjection {
  episodeNumber: number
  title: string
  status: EpisodeStatus
  scriptPath?: string
  directorAnalysisPath?: string
  artDesignPath?: string
  seedancePromptsPath?: string
  hasScript: boolean
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
  totalPrompts?: number
  totalDurationSeconds?: number
}

export interface EpisodeProjectionResult {
  episodes: EpisodeProjection[]
  inferredTotalEpisodes: number
}

function parseEpisodeNumberFromDirname(name: string): number | null {
  const match = name.match(/^ep(\d+)$/)
  return match ? parseInt(match[1], 10) : null
}

function parseEpisodeNumberFromFilename(name: string): number | null {
  const match = name.match(/^ep(\d+)\.md$/)
  return match ? parseInt(match[1], 10) : null
}

function summarizePromptFile(filePath: string): { totalPrompts?: number; totalDurationSeconds?: number } {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const sections = raw.split(/^## /m).slice(1)
    const totalPrompts = sections.filter((section) => section.trim().length > 0).length

    let totalDurationSeconds = 0
    for (const section of sections) {
      const durationMatch = section.match(/时长[：:]\s*(\d+)\s*[秒s]/i)
        || section.match(/建议时长[：:]\s*(\d+)/i)
        || section.match(/(\d+)\s*[秒s]/i)
      if (durationMatch) {
        totalDurationSeconds += parseInt(durationMatch[1], 10)
      }
    }

    return {
      totalPrompts: totalPrompts > 0 ? totalPrompts : undefined,
      totalDurationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : undefined
    }
  } catch {
    return {}
  }
}

function readAdaptPlanEpisodeHint(projectPath: string): number {
  const result = ensureProjectDataFileSync<AdaptPlan>(projectPath, 'adaptPlan')
  const raw = result.data as Partial<AdaptPlan> & { targetEpisodes?: unknown } | null
  if (!raw) return 0

  if (typeof raw.targetEpisodes === 'number' && Number.isFinite(raw.targetEpisodes)) {
    return Math.max(0, Math.floor(raw.targetEpisodes))
  }

  if (Array.isArray(raw.volumes)) {
    return raw.volumes.reduce((sum, volume) => {
      const count = typeof volume?.targetEpisodes === 'number' && Number.isFinite(volume.targetEpisodes)
        ? Math.max(0, Math.floor(volume.targetEpisodes))
        : 0
      return sum + count
    }, 0)
  }

  return 0
}

function collectEpisodeNumbers(projectPath: string): Set<number> {
  const numbers = new Set<number>()
  const outputsDir = join(projectPath, 'outputs')

  if (existsSync(outputsDir)) {
    for (const entry of readdirSync(outputsDir)) {
      const num = parseEpisodeNumberFromDirname(entry)
      if (num !== null) numbers.add(num)
    }
  }

  for (const entry of listScriptEpisodeFiles(projectPath)) {
    if (entry.episode !== null) {
      numbers.add(entry.episode)
    }
  }

  return numbers
}

function inferEpisodeStatus(input: {
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
}): EpisodeStatus {
  if (input.hasSeedancePrompts && input.hasDirectorAnalysis) return 'complete'
  if (input.hasArtDesign) return 'art'
  if (input.hasDirectorAnalysis) return 'director'
  return 'idle'
}

export function projectEpisodes(projectPath: string, baseTotalEpisodes: number): EpisodeProjectionResult {
  const scannedNumbers = collectEpisodeNumbers(projectPath)
  const planEpisodeHint = readAdaptPlanEpisodeHint(projectPath)
  const highestScanned = scannedNumbers.size > 0 ? Math.max(...scannedNumbers) : 0
  const inferredTotalEpisodes = Math.max(baseTotalEpisodes, planEpisodeHint, highestScanned)

  const episodeNumbers = new Set<number>(scannedNumbers)
  if (inferredTotalEpisodes > 0) {
    for (let episode = 1; episode <= inferredTotalEpisodes; episode++) {
      episodeNumbers.add(episode)
    }
  }

  const outputsDir = join(projectPath, 'outputs')
  const existingScriptFiles = new Map(
    listScriptEpisodeFiles(projectPath).map((file) => [file.episode, file])
  )
  const episodes = [...episodeNumbers]
    .sort((a, b) => a - b)
    .map((episodeNumber) => {
      const epStr = String(episodeNumber).padStart(3, '0')
      const scriptFile = existingScriptFiles.get(episodeNumber)
      const scriptPath = scriptFile?.filePath || getWritableScriptEpisodePath(projectPath, episodeNumber)
      const directorAnalysisPath = join(outputsDir, `ep${epStr}`, DIRECTOR_FILE)
      const artDesignPath = join(outputsDir, `ep${epStr}`, ART_FILE)
      const seedancePromptsPath = join(outputsDir, `ep${epStr}`, PROMPTS_FILE)

      const hasScript = Boolean(scriptFile)
      const hasDirectorAnalysis = existsSync(directorAnalysisPath)
      const hasArtDesign = existsSync(artDesignPath)
      const hasSeedancePrompts = existsSync(seedancePromptsPath)
      const promptSummary = hasSeedancePrompts ? summarizePromptFile(seedancePromptsPath) : {}

      return {
        episodeNumber,
        title: `第${episodeNumber}集`,
        status: inferEpisodeStatus({ hasDirectorAnalysis, hasArtDesign, hasSeedancePrompts }),
        scriptPath: hasScript ? scriptPath : undefined,
        directorAnalysisPath: hasDirectorAnalysis ? directorAnalysisPath : undefined,
        artDesignPath: hasArtDesign ? artDesignPath : undefined,
        seedancePromptsPath: hasSeedancePrompts ? seedancePromptsPath : undefined,
        hasScript,
        hasDirectorAnalysis,
        hasArtDesign,
        hasSeedancePrompts,
        totalPrompts: promptSummary.totalPrompts,
        totalDurationSeconds: promptSummary.totalDurationSeconds
      }
    })

  return {
    episodes,
    inferredTotalEpisodes
  }
}
