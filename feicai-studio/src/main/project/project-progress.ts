import { existsSync, statSync } from 'fs'
import { join } from 'path'
import {
  ArtifactRecord,
  EpisodeStatus,
  PipelineState,
  ProjectCommandResult,
  ProjectProgress,
  ProjectProgressEpisode,
  ProjectProgressSummary
} from '@shared/types'
import { projectEpisodes } from './episode-projection'
import { ensureProjectDataFileSync } from './project-data-compat'
import { getProjectByPath, syncEpisodeStatus } from '../db/queries'
import { getPipelineManager } from '../ipc/pipeline-handlers'
import { readProjectConfigSync } from './project-config-store'

const CHARACTER_PROMPTS_PATH = join('assets', 'character-prompts.md')
const SCENE_PROMPTS_PATH = join('assets', 'scene-prompts.md')

function getStageStateLabel(stageState?: ProjectProgressEpisode['stageState']): string | undefined {
  switch (stageState) {
    case 'running':
      return '进行中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '审核失败待处理'
    case 'pending':
      return '待开始'
    default:
      return undefined
  }
}

function getStatusLabel(status: EpisodeStatus, stageState?: ProjectProgressEpisode['stageState']): ProjectProgressEpisode['statusLabel'] {
  if (stageState === 'running') {
    if (status === 'director') return '导演分析中'
    if (status === 'art') return '服化道进行中'
    if (status === 'storyboard') return '分镜生成中'
  }

  if (stageState === 'failed' && status !== 'idle') return '审核失败待处理'

  switch (status) {
    case 'director':
      return '导演分析'
    case 'art':
      return '服化道'
    case 'storyboard':
      return '分镜'
    case 'complete':
      return '已完成'
    case 'idle':
    default:
      return '未开始'
  }
}

function readCurrentArtifacts(projectPath: string): ArtifactRecord[] {
  const result = ensureProjectDataFileSync<{ artifacts?: ArtifactRecord[] }>(projectPath, 'artifactManifest')
  const data = result.data
  const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : []
  return artifacts.filter((artifact) => artifact.isCurrent)
}

function getAssetUpdatesByEpisode(projectPath: string): Map<number, Set<'character' | 'scene'>> {
  const updates = new Map<number, Set<'character' | 'scene'>>()
  const artifacts = readCurrentArtifacts(projectPath)

  for (const artifact of artifacts) {
    if (artifact.kind !== 'character_prompts' && artifact.kind !== 'scene_prompts') continue
    const episodeNum = typeof artifact.metadata?.episodeNum === 'number'
      ? artifact.metadata.episodeNum
      : typeof artifact.episodeNum === 'number'
        ? artifact.episodeNum
        : undefined
    if (typeof episodeNum !== 'number' || !Number.isFinite(episodeNum)) continue

    const current = updates.get(episodeNum) || new Set<'character' | 'scene'>()
    current.add(artifact.kind === 'character_prompts' ? 'character' : 'scene')
    updates.set(episodeNum, current)
  }

  if (updates.size > 0) {
    return updates
  }

  const characterPath = join(projectPath, CHARACTER_PROMPTS_PATH)
  const scenePath = join(projectPath, SCENE_PROMPTS_PATH)
  const characterMtime = existsSync(characterPath) ? statSync(characterPath).mtimeMs : 0
  const sceneMtime = existsSync(scenePath) ? statSync(scenePath).mtimeMs : 0

  if (characterMtime <= 0 && sceneMtime <= 0) {
    return updates
  }

  for (const episode of projectEpisodes(projectPath, 0).episodes) {
    if (!episode.artDesignPath || !existsSync(episode.artDesignPath)) continue
    const artMtime = statSync(episode.artDesignPath).mtimeMs
    const current = new Set<'character' | 'scene'>()
    if (characterMtime >= artMtime && characterMtime > 0) current.add('character')
    if (sceneMtime >= artMtime && sceneMtime > 0) current.add('scene')
    if (current.size > 0) {
      updates.set(episode.episodeNumber, current)
    }
  }

  return updates
}

function normalizeStatus(input: {
  hasDirectorAnalysis: boolean
  hasArtDesign: boolean
  hasSeedancePrompts: boolean
  hasAssetUpdates: boolean
  currentPipelineState?: PipelineState
  storyboardCompleted: boolean
  hasStoryboardActivity: boolean
}): EpisodeStatus {
  if (input.currentPipelineState?.startsWith('director_')) return 'director'
  if (input.currentPipelineState?.startsWith('art_')) return 'art'
  if (input.currentPipelineState?.startsWith('storyboard_')) return 'storyboard'
  if (input.storyboardCompleted) return 'complete'
  if (input.hasSeedancePrompts || input.hasStoryboardActivity) return 'storyboard'
  if (input.hasArtDesign || input.hasAssetUpdates) return 'art'
  if (input.hasDirectorAnalysis) return 'director'
  return 'idle'
}

function buildSummary(episodes: ProjectProgressEpisode[]): ProjectProgressSummary {
  const counts: Record<EpisodeStatus, number> = {
    idle: 0,
    director: 0,
    art: 0,
    storyboard: 0,
    complete: 0
  }

  for (const episode of episodes) {
    counts[episode.status] += 1
  }

  const totalEpisodes = episodes.length
  const completedEpisodes = counts.complete
  const startedEpisodes = totalEpisodes - counts.idle

  return {
    totalEpisodes,
    counts,
    completedEpisodes,
    startedEpisodes,
    completionRate: totalEpisodes > 0 ? Number((completedEpisodes / totalEpisodes).toFixed(4)) : 0
  }
}

function resolveStageState(input: {
  status: EpisodeStatus
  currentPipelineState?: PipelineState
  hasError: boolean
}): ProjectProgressEpisode['stageState'] {
  if (input.hasError) return 'failed'
  if (input.currentPipelineState && !['idle', 'director_done', 'art_done', 'episode_complete', 'paused'].includes(input.currentPipelineState)) {
    return 'running'
  }
  if (input.status === 'idle') return 'pending'
  return 'completed'
}

export function calculateProjectProgress(projectPath: string, totalEpisodesHint = 0): ProjectProgress {
  const projection = projectEpisodes(projectPath, totalEpisodesHint)
  const assetUpdatesByEpisode = getAssetUpdatesByEpisode(projectPath)
  const stateResult = ensureProjectDataFileSync<any>(projectPath, 'projectState')
  const projectState = stateResult.data
  const runtimeContext = projectState?.runtime?.context

  const episodes: ProjectProgressEpisode[] = projection.episodes.map((episode) => {
    const assetUpdateKinds = [...(assetUpdatesByEpisode.get(episode.episodeNumber) || new Set<'character' | 'scene'>())]
      .sort()
    const hasAssetUpdates = assetUpdateKinds.length > 0
    const persistedEpisodeState = projectState?.episodes?.[episode.episodeNumber]
    const currentPipelineState = runtimeContext?.episodeNum === episode.episodeNumber
      ? runtimeContext.state as PipelineState
      : persistedEpisodeState?.lastStage === 'director' && persistedEpisodeState?.status === 'director' && projectState?.runtime?.status === 'running'
        ? 'director_analyzing' as PipelineState
        : persistedEpisodeState?.lastStage === 'art' && persistedEpisodeState?.status === 'art' && projectState?.runtime?.status === 'running'
          ? 'art_designing' as PipelineState
          : undefined
    const latestReviewResult = persistedEpisodeState?.reviews?.[persistedEpisodeState.reviews.length - 1]?.result
    const storyboardCompleted = Boolean(persistedEpisodeState?.completedStages?.includes('storyboard'))
    const hasStoryboardActivity = Boolean(
      persistedEpisodeState?.lastStage === 'storyboard'
      || persistedEpisodeState?.reviews?.some((review) => review.stage === 'storyboard')
    )
    const hasError = runtimeContext?.episodeNum === episode.episodeNumber
      ? runtimeContext.state === 'error'
      : Boolean(latestReviewResult === 'FAIL' && persistedEpisodeState?.lastStage)
    const status = normalizeStatus({
      hasDirectorAnalysis: episode.hasDirectorAnalysis,
      hasArtDesign: episode.hasArtDesign,
      hasSeedancePrompts: episode.hasSeedancePrompts,
      hasAssetUpdates,
      currentPipelineState,
      storyboardCompleted,
      hasStoryboardActivity
    })
    const stageState = resolveStageState({ status, currentPipelineState, hasError })

    return {
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      status,
      statusLabel: getStatusLabel(status, stageState),
      stageState,
      stageStateLabel: getStageStateLabel(stageState),
      currentPipelineState,
      lastError: runtimeContext?.episodeNum === episode.episodeNumber ? runtimeContext.error : undefined,
      scriptPath: episode.scriptPath,
      directorAnalysisPath: episode.directorAnalysisPath,
      artDesignPath: episode.artDesignPath,
      seedancePromptsPath: episode.seedancePromptsPath,
      hasScript: episode.hasScript,
      hasDirectorAnalysis: episode.hasDirectorAnalysis,
      hasArtDesign: episode.hasArtDesign,
      hasSeedancePrompts: episode.hasSeedancePrompts,
      hasAssetUpdates,
      assetUpdateKinds,
      totalDurationSeconds: episode.totalDurationSeconds,
      totalPrompts: episode.totalPrompts
    }
  })

  return {
    projectPath,
    generatedAt: new Date().toISOString(),
    episodes,
    summary: buildSummary(episodes)
  }
}

export function formatProjectProgressText(progress: ProjectProgress): string {
  const { summary, episodes } = progress
  const lines = [
    `项目进度：共 ${summary.totalEpisodes} 集，已完成 ${summary.completedEpisodes} 集，已启动 ${summary.startedEpisodes} 集`,
    `阶段统计：未开始 ${summary.counts.idle} / 导演分析 ${summary.counts.director} / 服化道 ${summary.counts.art} / 分镜 ${summary.counts.storyboard} / 已完成 ${summary.counts.complete}`
  ]

  if (episodes.length > 0) {
    lines.push('', '分集状态：')
    for (const episode of episodes) {
      const suffix: string[] = []
      if (episode.hasAssetUpdates) {
        suffix.push(`assets新增:${episode.assetUpdateKinds.join('+')}`)
      }
      if (typeof episode.totalPrompts === 'number') {
        suffix.push(`提示词${episode.totalPrompts}条`)
      }
      if (typeof episode.totalDurationSeconds === 'number') {
        suffix.push(`时长${episode.totalDurationSeconds}秒`)
      }
      lines.push(`- EP${String(episode.episodeNumber).padStart(3, '0')} ${episode.statusLabel}${suffix.length > 0 ? `（${suffix.join('，')}）` : ''}`)
    }
  }

  return lines.join('\n')
}

export async function runProjectCommand(input: {
  command: string
  projectPath: string
  totalEpisodesHint?: number
}): Promise<ProjectCommandResult> {
  const command = input.command.trim()

  if (command === '~status') {
    const progress = calculateProjectProgress(input.projectPath, input.totalEpisodesHint || 0)
    return {
      command,
      text: formatProjectProgressText(progress),
      progress
    }
  }

  const startMatch = command.match(/^~(?:start\s+director|design|start\s+(?:art|design)|prompt|start\s+(?:storyboard|prompt))(?:\s+ep(?:isode)?0*(\d+))?$/i)
  if (startMatch) {
    const episodeNum = startMatch[1] ? parseInt(startMatch[1], 10) : 1
    const normalizedCommand = command.toLowerCase()
    const startStage = normalizedCommand.includes('director')
      ? 'director'
      : (normalizedCommand.includes('prompt') || normalizedCommand.includes('storyboard'))
        ? 'storyboard'
        : 'art'
    const project = getProjectByPath(input.projectPath)
    if (!project) {
      throw new Error(`当前项目未注册: ${input.projectPath}`)
    }

    const config = readProjectConfigSync(input.projectPath)
    const pipelineSettings = config?.pipelineSettings
    const manager = getPipelineManager()
    const result = await manager.runAndWait({
      projectId: project.id,
      projectPath: input.projectPath,
      episodeNum,
      projectContext: {
        projectName: project.name,
        visualStyle: project.visualStyle,
        targetMedium: project.targetMedium,
        episodeNumber: episodeNum,
        durationMin: pipelineSettings?.durationMin || 90,
        durationMax: pipelineSettings?.durationMax || 120,
        singlePromptMax: pipelineSettings?.singlePromptMax || 10
      },
      startStage,
      singleStage: true
    })

    syncEpisodeStatus(project.id, input.projectPath)
    const progress = calculateProjectProgress(input.projectPath, input.totalEpisodesHint || 0)
    const ctx = manager.getContext()
    const success = startStage === 'director'
      ? result.state === 'director_done' && result.stage === 'director'
      : startStage === 'art'
        ? result.state === 'art_done' && result.stage === 'art'
        : result.state === 'episode_complete' && result.stage === 'storyboard'

    return {
      command,
      text: success
        ? startStage === 'director'
          ? `EP${String(episodeNum).padStart(2, '0')} 导演阶段已完成，产物已写入 ${ctx.directorAnalysisPath || 'outputs/epXXX/01-director-analysis.md'}`
          : startStage === 'art'
            ? `EP${String(episodeNum).padStart(2, '0')} 服化道阶段已完成，产物已写入 outputs/ep${String(episodeNum).padStart(3, '0')}/01.5-art-design-output.md，并已更新 assets/character-prompts.md、assets/scene-prompts.md`
            : `EP${String(episodeNum).padStart(2, '0')} 分镜阶段已完成，产物已写入 ${ctx.seedancePromptsPath || `outputs/ep${String(episodeNum).padStart(3, '0')}/02-seedance-prompts.md`}`
        : `EP${String(episodeNum).padStart(2, '0')} ${startStage === 'director' ? '导演' : startStage === 'art' ? '服化道' : '分镜'}阶段执行失败：${ctx.error || result.state}`,
      progress,
      data: {
        success,
        episodeNum,
        state: result.state,
        stage: result.stage,
        outputPath: startStage === 'director'
          ? ctx.directorAnalysisPath
          : startStage === 'art'
            ? `outputs/ep${String(episodeNum).padStart(3, '0')}/01.5-art-design-output.md`
            : (ctx.seedancePromptsPath || `outputs/ep${String(episodeNum).padStart(3, '0')}/02-seedance-prompts.md`),
        error: ctx.error,
        reviews: ctx.reviews
      }
    }
  }

  throw new Error(`unsupported project command: ${command}`)
}
