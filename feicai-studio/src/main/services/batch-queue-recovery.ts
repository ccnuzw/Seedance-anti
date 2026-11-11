import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import type { BatchWorkflowBaseParams } from '@shared/batch'
import type {
  PipelineStartResult,
  WorkflowActionResult
} from '@shared/ipc-contracts'
import type {
  AutomatedPipelineStage,
  ProjectPipelineState,
  ReviewStage
} from '@shared/types'
import { readJsonWithRecovery, readRegularFile } from '../io/atomic-file'
import {
  isMissingFileError,
  assertPathWithinProject
} from '../security/access-control'
import { getProjectByPath } from './project-service'
import { isReviewCurrent } from '../engine/artifact-provenance'
import { ProjectStatePersistence } from '../engine/project-state'
import { deriveEpisodeStatusFromStage } from '../engine/state-machine-meta'

/** Recover only a commit bearing this exact main-generated operation ID. */
export async function recoverBatchCommit(
  action: string,
  params: BatchWorkflowBaseParams,
  operationId: string
): Promise<WorkflowActionResult | PipelineStartResult | null> {
  const config = getProjectByPath(params.projectPath)?.config
  const stage = action as AutomatedPipelineStage
  if (['director', 'art', 'storyboard'].includes(action)) {
    const path = assertPathWithinProject(
      params.projectPath,
      resolveProjectArtifactPath(params.projectPath, 'pipelineState', config)
    )
    const state = await readJsonWithRecovery<ProjectPipelineState>(path)
    const snapshot = state?.episodes[params.episodeNum]?.stageStates[stage]
    if (snapshot?.operationId !== operationId || !snapshot.lastReview)
      return null
    if (
      snapshot.lastReview.passed &&
      !isReviewCurrent(
        snapshot.lastReview,
        params.projectPath,
        params.episodeNum,
        config
      )
    ) {
      throw new Error('已提交制作阶段的产物已变更，请停止旧队列后重新选择任务')
    }
    if (!snapshot.lastReview.passed) return null
    const project = getProjectByPath(params.projectPath)
    if (!project) throw new Error('恢复队列项目不存在')
    const persistence = new ProjectStatePersistence(
      params.projectPath,
      project.id,
      config
    )
    await persistence.load()
    await persistence.updateEpisodeStatus(
      params.episodeNum,
      deriveEpisodeStatusFromStage(stage)
    )
    return {
      success: true,
      state:
        stage === 'storyboard'
          ? 'episode_complete'
          : stage === 'director'
            ? 'director_done'
            : 'art_done',
      stage
    }
  }
  const mapping = {
    runStoryGeneration: ['storyBeat', 'story'],
    runStoryReview: ['storyReview', 'story_review'],
    runScriptGeneration: ['script', 'script'],
    runScriptReview: ['scriptReview', 'script_review']
  } as const
  if (!(action in mapping)) return null
  const [artifact, workflowStage] = mapping[action as keyof typeof mapping]
  const path = assertPathWithinProject(
    params.projectPath,
    resolveEpisodeArtifactPath(
      params.projectPath,
      artifact,
      params.episodeNum,
      config
    )
  )
  let content: string
  try {
    content = (await readRegularFile(path)).toString('utf8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
  if (!content.includes(`<!-- feicai-operation:${operationId} -->`)) return null
  if (workflowStage === 'story_review' || workflowStage === 'script_review') {
    const review = parseReviewMarkdown(content, workflowStage as ReviewStage)
    if (!review) throw new Error('已提交审核收据无法解析')
    if (
      review.passed &&
      !isReviewCurrent(review, params.projectPath, params.episodeNum, config)
    ) {
      throw new Error('已提交审核的产物已变更，请停止旧队列后重新选择任务')
    }
    return {
      success: review.passed,
      stage: workflowStage,
      outputPath: path,
      review
    }
  }
  return { success: true, stage: workflowStage, outputPath: path }
}
