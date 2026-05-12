import { readFile } from 'fs/promises'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
import type {
  AutomatedPipelineStage,
  PipelineContext,
  PipelineState,
  ProjectConfig
} from '@shared/types'
import type { ProjectContext } from './prompt-assembler'
import type { ProjectStatePersistence } from './project-state'
import { ProjectStatePersistence as ProjectStatePersistenceCtor } from './project-state'
import {
  deriveEpisodeStatusFromStage,
  getPipelineStageName,
  PIPELINE_STAGE_ORDER,
  PIPELINE_STAGE_STATES,
  PIPELINE_TERMINAL_STATES
} from './state-machine-meta'

export interface StartPipelineParams {
  projectId: string
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  projectConfig?: Partial<ProjectConfig> | null
  startStage?: AutomatedPipelineStage
  singleStage?: boolean
}

export interface PrepareStartContext {
  params: StartPipelineParams
  llmConfigured: boolean
  currentState: PipelineState
  onResetFlags: () => void
  onContextInitialized: (ctx: PipelineContext) => void
  onProjectContextAssigned: (ctx: ProjectContext) => void
  onProjectConfigAssigned: (config: Partial<ProjectConfig> | null) => void
  onStatePersistenceAssigned: (persistence: ProjectStatePersistence) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onStateChange: (state: PipelineState) => void
  onScriptPathAssigned: (scriptPath: string) => void
  onError: (message: string, error: unknown) => void
}

export async function preparePipelineStart(ctx: PrepareStartContext): Promise<{
  stageSequence: AutomatedPipelineStage[]
} | null> {
  if (!ctx.llmConfigured) {
    throw new Error('请先配置 LLM Provider')
  }

  if (!PIPELINE_TERMINAL_STATES.includes(ctx.currentState)) {
    throw new Error(`无法在 ${ctx.currentState} 状态下启动流水线`)
  }

  const startStage = ctx.params.startStage || 'director'
  ctx.onResetFlags()
  ctx.onContextInitialized({
    projectId: ctx.params.projectId,
    projectPath: ctx.params.projectPath,
    episodeNum: ctx.params.episodeNum,
    currentStage: startStage,
    state: 'idle',
    retryCount: 0,
    reviews: [],
    logs: []
  })
  ctx.onProjectContextAssigned(ctx.params.projectContext)
  ctx.onProjectConfigAssigned(ctx.params.projectConfig || null)

  const persistence = new ProjectStatePersistenceCtor(
    ctx.params.projectPath,
    ctx.params.projectId,
    ctx.params.projectConfig || null
  )
  await persistence.load()
  ctx.onStatePersistenceAssigned(persistence)

  const scriptPath = resolveEpisodeArtifactPath(
    ctx.params.projectPath,
    'script',
    ctx.params.episodeNum,
    ctx.params.projectConfig || null
  )

  try {
    await readFile(scriptPath, 'utf-8')
    ctx.onScriptPathAssigned(scriptPath)
    ctx.onLog('info', 'script_loaded', `剧本已加载: ${scriptPath}`)
    ctx.onStateChange('script_done')
  } catch (error) {
    ctx.onError('加载剧本失败', error)
    return null
  }

  const startIdx = PIPELINE_STAGE_ORDER.indexOf(startStage)
  const stageSequence = PIPELINE_STAGE_ORDER.slice(
    startIdx,
    ctx.params.singleStage ? startIdx + 1 : PIPELINE_STAGE_ORDER.length
  )
  return { stageSequence }
}

export function finalizeSingleStageRun(params: {
  startStage?: AutomatedPipelineStage
  shouldStop: () => boolean
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onStateChange: (state: PipelineState) => void
}): void {
  const stage = params.startStage || 'director'
  if (params.shouldStop()) return

  params.onLog(
    'info',
    'single_stage_done',
    `✅ 单阶段模式完成: ${getPipelineStageName(stage)}`
  )
  params.onStateChange(PIPELINE_STAGE_STATES[stage].done)
}

export function performSkipReview(params: {
  stage: AutomatedPipelineStage
  episodeNum: number
  statePersistence: ProjectStatePersistence | null
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onStateChange: (state: PipelineState) => void
}): void {
  params.onLog(
    'warn',
    'review_skipped',
    `⏭ 已跳过 ${getPipelineStageName(params.stage)} 审核`
  )
  params.onStateChange(PIPELINE_STAGE_STATES[params.stage].done)

  if (params.statePersistence) {
    params.statePersistence
      .markStageSkipped(params.episodeNum, params.stage)
      .catch(console.error)
    params.statePersistence
      .updateEpisodeStatus(
        params.episodeNum,
        deriveEpisodeStatusFromStage(params.stage)
      )
      .catch(console.error)
  }
}

export function createResetContext(): PipelineContext {
  return {
    projectId: '',
    projectPath: '',
    episodeNum: 0,
    currentStage: 'director',
    state: 'idle',
    retryCount: 0,
    reviews: [],
    logs: []
  }
}
