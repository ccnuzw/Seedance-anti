import { STAGE_SKILL_MAP } from '@shared/constants'
import type {
  AutomatedPipelineStage,
  PipelineSettings,
  ProjectConfig,
  ReviewResult
} from '@shared/types'
import type { ProjectContext } from './prompt-assembler'
import type { WorkflowEngine } from '../workflow/workflow-engine'
import type { ProjectStatePersistence } from './project-state'
import {
  getPipelineStageName,
  PIPELINE_STAGE_STATES
} from './state-machine-meta'

export interface StageGenerationContext {
  stage: AutomatedPipelineStage
  workflowEngine: WorkflowEngine
  projectPath: string
  episodeNum: number
  projectContext: ProjectContext
  projectConfig: Partial<ProjectConfig> | null
  pipelineSettings: PipelineSettings
  reviewFeedback?: string
  statePersistence: ProjectStatePersistence | null
  getStageOutputPath: (stage: AutomatedPipelineStage) => string | undefined
  onStateChange: (state: string) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onStream: (payload: {
    stage: AutomatedPipelineStage
    chunk: string
    totalLength: number
  }) => void
  shouldStop: () => boolean
  onDirectorOutputPath: (path: string) => void
  onStoryboardOutputPath: (path: string) => void
  onError: (message: string, error: unknown) => void
}

export interface StageReviewContext {
  stage: AutomatedPipelineStage
  workflowEngine: WorkflowEngine
  projectPath: string
  episodeNum: number
  scriptPath?: string
  projectConfig: Partial<ProjectConfig> | null
  onStateChange: (state: string) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onReviewAppended: (review: ReviewResult) => void
  onReviewResult: (payload: {
    stage: AutomatedPipelineStage
    result: ReviewResult
  }) => void
  onError: (message: string, error: unknown) => void
}

export async function runStageGeneration(
  ctx: StageGenerationContext
): Promise<void> {
  const { stage } = ctx
  ctx.onStateChange(PIPELINE_STAGE_STATES[stage].executing)

  const stageEmoji = { director: '🎬', art: '🎨', storyboard: '📐' }[stage]
  ctx.onLog(
    'info',
    'stage_start',
    `${stageEmoji} 开始${getPipelineStageName(stage)}`
  )

  try {
    if (ctx.statePersistence) {
      await ctx.statePersistence.markStageRunning(ctx.episodeNum, stage, {
        outputPath: ctx.getStageOutputPath(stage)
      })
    }

    ctx.onLog('info', 'skill_loading', `加载技能: ${STAGE_SKILL_MAP[stage]}`)
    const retryNote = ctx.reviewFeedback ? ' [带审核反馈]' : ''
    ctx.onLog('info', 'llm_calling', '调用 LLM 生成中...')

    const result = await ctx.workflowEngine.generateStage(
      stage,
      {
        projectPath: ctx.projectPath,
        episodeNum: ctx.episodeNum,
        projectContext: ctx.projectContext,
        projectConfig: ctx.projectConfig
      },
      {
        reviewFeedback: ctx.reviewFeedback,
        timeoutMs: ctx.pipelineSettings.llmTimeoutSec * 1000,
        onChunk: (chunk, totalLength) => {
          if (ctx.shouldStop()) {
            throw new Error('流水线已中断')
          }
          ctx.onStream({ stage, chunk, totalLength })
        }
      }
    )

    ctx.onLog(
      'info',
      'prompt_assembled',
      `Prompt 已组装 (system: ${result.promptMetrics.systemChars} chars, user: ${result.promptMetrics.userChars} chars)${retryNote}`
    )
    ctx.onLog(
      'info',
      'llm_complete',
      `LLM 生成完成 (${result.content.length} chars)`
    )

    if (stage === 'director') {
      ctx.onDirectorOutputPath(result.outputPath)
    } else if (stage === 'storyboard') {
      ctx.onStoryboardOutputPath(result.outputPath)
    }

    ctx.onLog('info', 'file_written', `产出已写入: ${result.outputPath}`)
    if (stage === 'art') {
      ctx.onLog('info', 'assets_merged', '素材已合并到 assets/')
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    if (errMsg === '流水线已中断') {
      ctx.onLog('info', 'aborted_during_gen', '⚓ LLM 生成已中断')
      return
    }

    const isTimeout = errMsg.includes('超时')
    const isNetwork =
      errMsg.includes('fetch') ||
      errMsg.includes('ECONNREFUSED') ||
      errMsg.includes('ETIMEDOUT')
    const hint = isTimeout
      ? '（将自动重试）'
      : isNetwork
        ? '（网络错误，请检查连接）'
        : ''
    ctx.onError(`${getPipelineStageName(stage)}执行失败${hint}`, error)
  }
}

export async function runStageReview(
  ctx: StageReviewContext
): Promise<ReviewResult | null> {
  const { stage } = ctx
  ctx.onStateChange(PIPELINE_STAGE_STATES[stage].reviewing)
  ctx.onLog('info', 'review_start', '⚠️ 开始审核 (对抗性立场 + 评分锚定 7 分)')

  try {
    const reviewStage = stage === 'storyboard' ? 'storyboard_review' : stage
    const result = await ctx.workflowEngine.reviewStage(reviewStage, {
      projectPath: ctx.projectPath,
      episodeNum: ctx.episodeNum,
      scriptPath: ctx.scriptPath,
      projectConfig: ctx.projectConfig
    })

    ctx.onReviewAppended(result.review)
    ctx.onReviewResult({ stage, result: result.review })
    return result.review
  } catch (error) {
    ctx.onError('审核执行失败', error)
    return null
  }
}
