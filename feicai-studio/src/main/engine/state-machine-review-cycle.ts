import type { AutomatedPipelineStage, ReviewResult } from '@shared/types'
import type { ProjectStatePersistence } from './project-state'
import {
  deriveEpisodeStatusFromStage,
  PIPELINE_STAGE_STATES
} from './state-machine-meta'

export interface ReviewCycleContext {
  stage: AutomatedPipelineStage
  reviewResult: ReviewResult | null
  episodeNum: number
  retryCount: number
  maxRetries: number
  statePersistence: ProjectStatePersistence | null
  operationId?: string
  getStageOutputPath: (stage: AutomatedPipelineStage) => string | undefined
  getStageReviewPath: (stage: AutomatedPipelineStage) => string | undefined
  onStateChange: (state: string) => void
  onLog: (
    level: 'info' | 'warn' | 'error' | 'debug',
    eventType: string,
    message: string
  ) => void
  onStageComplete: (payload: {
    stage: AutomatedPipelineStage
    result: ReviewResult
  }) => void
}

export interface ReviewCycleOutcome {
  passed: boolean
  nextRetryCount: number
  nextReviewFeedback?: string
  exhausted: boolean
  exhaustedMessage?: string
}

async function persistReviewResult(
  persistence: ProjectStatePersistence | null,
  episodeNum: number,
  stage: AutomatedPipelineStage,
  review: ReviewResult,
  getStageOutputPath: (stage: AutomatedPipelineStage) => string | undefined,
  getStageReviewPath: (stage: AutomatedPipelineStage) => string | undefined,
  operationId: string | undefined
): Promise<void> {
  if (!persistence) return
  await persistence.markStageReviewResult(episodeNum, stage, review, {
    outputPath: getStageOutputPath(stage),
    reviewPath: getStageReviewPath(stage),
    operationId
  })
}

export async function handleReviewCycleResult(
  ctx: ReviewCycleContext
): Promise<ReviewCycleOutcome> {
  const { stage, reviewResult } = ctx

  if (reviewResult?.passed) {
    await persistReviewResult(
      ctx.statePersistence,
      ctx.episodeNum,
      stage,
      reviewResult,
      ctx.getStageOutputPath,
      ctx.getStageReviewPath,
      ctx.operationId
    )
    if (ctx.statePersistence) {
      await ctx.statePersistence.updateEpisodeStatus(
        ctx.episodeNum,
        deriveEpisodeStatusFromStage(stage)
      )
    }
    ctx.onStateChange(PIPELINE_STAGE_STATES[stage].done)
    ctx.onLog(
      'info',
      'stage_complete',
      `✅ ${stage} 阶段通过审核 (${reviewResult.score}分)`
    )
    ctx.onStageComplete({ stage, result: reviewResult })

    return {
      passed: true,
      nextRetryCount: ctx.retryCount,
      nextReviewFeedback: undefined,
      exhausted: false
    }
  }

  const nextRetryCount = ctx.retryCount + 1
  const reviewScore = reviewResult ? reviewResult.score : 0

  if (reviewResult) {
    await persistReviewResult(
      ctx.statePersistence,
      ctx.episodeNum,
      stage,
      reviewResult,
      ctx.getStageOutputPath,
      ctx.getStageReviewPath,
      ctx.operationId
    )
  }

  if (nextRetryCount > ctx.maxRetries) {
    return {
      passed: false,
      nextRetryCount,
      nextReviewFeedback: reviewResult?.feedback || undefined,
      exhausted: true,
      exhaustedMessage: `${stage} 阶段审核失败超过最大重试次数 (最后得分: ${reviewScore})`
    }
  }

  ctx.onLog(
    'warn',
    'review_fail',
    `❌ ${stage} 审核未通过 (得分: ${reviewScore}/10)，将带审核反馈重试 (${nextRetryCount}/${ctx.maxRetries})`
  )

  return {
    passed: false,
    nextRetryCount,
    nextReviewFeedback: reviewResult?.feedback || undefined,
    exhausted: false
  }
}
