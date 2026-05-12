import {
  getExceptionMessage,
  getServiceErrorMessage,
  isServiceSuccess
} from '@renderer/services/service-contracts'
import type { AutomatedPipelineStage } from '@shared/types'
import type {
  PipelineStartParams,
  WorkflowActionParams
} from '@renderer/services/workflow-actions'
import type {
  ServicePipelineStartResult,
  ServiceWorkflowActionResult
} from '@renderer/services/service-contracts'

export type BatchMode =
  | 'smart_next'
  | 'preproduction'
  | 'story_until_ready'
  | 'story_until_done'
  | 'script_until_empty'
  | 'story'
  | 'story_review'
  | 'script'
  | 'script_review'
  | 'full'
  | 'director'
  | 'art'
  | 'storyboard'

export const MODE_MAP: Record<
  BatchMode,
  {
    label: string
    emoji: string
    stage?: AutomatedPipelineStage
    workflow?: true
    autoSelect?: true
  }
> = {
  smart_next: { label: '智能下一步', emoji: '🧭', workflow: true, autoSelect: true },
  preproduction: { label: '库存到剧审', emoji: '🧱', workflow: true },
  story_until_ready: {
    label: '拆到库存充足',
    emoji: '📚',
    workflow: true,
    autoSelect: true
  },
  story_until_done: {
    label: '拆到目标上限',
    emoji: '🧩',
    workflow: true,
    autoSelect: true
  },
  script_until_empty: {
    label: '生成到库存用完',
    emoji: '📖',
    workflow: true,
    autoSelect: true
  },
  story: { label: '拆解一批', emoji: '🧩', workflow: true },
  story_review: { label: '批次审核', emoji: '🔎', workflow: true },
  script: { label: '剧本生成', emoji: '📖', workflow: true },
  script_review: { label: '剧本审核', emoji: '📝', workflow: true },
  full: { label: '全流程', emoji: '🚀' },
  director: { label: '导演分析', emoji: '🎬', stage: 'director' },
  art: { label: '服化道', emoji: '🎨', stage: 'art' },
  storyboard: { label: '分镜编写', emoji: '📐', stage: 'storyboard' }
}

export interface BatchWorkflowDeps {
  runStoryGeneration: (
    params: WorkflowActionParams
  ) => Promise<ServiceWorkflowActionResult>
  runStoryReview: (
    params: WorkflowActionParams
  ) => Promise<ServiceWorkflowActionResult>
  runScriptGeneration: (
    params: WorkflowActionParams
  ) => Promise<ServiceWorkflowActionResult>
  runScriptReview: (
    params: WorkflowActionParams
  ) => Promise<ServiceWorkflowActionResult>
}

export interface BatchWorkflowBaseParams {
  projectPath: string
  episodeNum: number
  projectName: string
  visualStyle: string
  targetMedium: string
  maxRetries?: number
  plotBreakdown?: {
    unusedEntries: number
    unprocessedChapterCount: number | null
    nextActionMode: 'script' | 'breakdown' | 'done'
  } | null
}

export interface BatchWorkflowRunResult {
  success: boolean
  stage: BatchMode
  message: string
  result?: ServiceWorkflowActionResult
}

export interface BatchAutoSelectionInput {
  mode: BatchMode
  selectedEpisodes: number[]
  allEpisodes: number[]
  waterline?: {
    unusedEntries: number
    readyEpisodeNumbers: number[]
    nextBatchNumber: number
    unprocessedChapterCount: number | null
    nextActionMode: 'script' | 'breakdown' | 'done'
  } | null
}

export function isWorkflowBatchMode(mode: BatchMode): boolean {
  return !!MODE_MAP[mode].workflow
}

export function isAutoSelectBatchMode(mode: BatchMode): boolean {
  return !!MODE_MAP[mode].autoSelect
}

export function resolveBatchExecutionEpisodes(
  input: BatchAutoSelectionInput
): number[] {
  const selected = [...new Set(input.selectedEpisodes)]
    .filter((num) => Number.isInteger(num) && num > 0)
    .sort((a, b) => a - b)
  if (!isAutoSelectBatchMode(input.mode)) return selected

  const waterline = input.waterline
  const allEpisodes = [...new Set(input.allEpisodes)]
    .filter((num) => Number.isInteger(num) && num > 0)
    .sort((a, b) => a - b)

  if (input.mode === 'smart_next') {
    if (waterline?.nextActionMode === 'breakdown') {
      return [waterline.nextBatchNumber || 1]
    }
    if (waterline?.nextActionMode === 'script') {
      return waterline.readyEpisodeNumbers.length > 0
        ? [waterline.readyEpisodeNumbers[0]]
        : selected.slice(0, 1)
    }
    return []
  }

  if (input.mode === 'story_until_ready') {
    if (!waterline || waterline.unprocessedChapterCount === 0) return []
    return waterline.unusedEntries >= 6 ? [] : [waterline.nextBatchNumber || 1]
  }

  if (input.mode === 'story_until_done') {
    if (!waterline || waterline.unprocessedChapterCount === 0) return []
    const remainingBatches = Math.max(
      1,
      Math.ceil((waterline.unprocessedChapterCount || 0) / 6)
    )
    const start = waterline.nextBatchNumber || 1
    return Array.from({ length: remainingBatches }, (_item, index) => start + index)
  }

  if (input.mode === 'script_until_empty') {
    return waterline?.readyEpisodeNumbers.length
      ? waterline.readyEpisodeNumbers
      : selected.length
        ? selected
        : allEpisodes
  }

  return selected
}

export function buildBatchPipelineParams(
  base: Omit<PipelineStartParams, 'startStage' | 'singleStage'>,
  mode: BatchMode
): PipelineStartParams {
  const modeConfig = MODE_MAP[mode]
  return {
    ...base,
    startStage: modeConfig.stage,
    singleStage: !!modeConfig.stage
  }
}

async function runWorkflowStep(
  mode: BatchMode,
  params: BatchWorkflowBaseParams,
  deps: BatchWorkflowDeps,
  reviewFeedback?: string
): Promise<ServiceWorkflowActionResult> {
  if (mode === 'story') {
    return await deps.runStoryGeneration({ ...params, reviewFeedback })
  }
  if (mode === 'story_review') {
    return await deps.runStoryReview(params)
  }
  if (mode === 'script') {
    return await deps.runScriptGeneration({ ...params, reviewFeedback })
  }
  if (mode === 'script_review') {
    return await deps.runScriptReview(params)
  }
  return { success: false, error: `不支持的批量 workflow 模式: ${mode}` }
}

function isMissingStoryInventory(result: ServiceWorkflowActionResult): boolean {
  if (result.success) return false
  const message = result.error || ''
  return (
    message.includes('缺少当前集未用剧情点') ||
    message.includes('未用剧情点') ||
    message.includes('剧情库存')
  )
}

async function ensureStoryInventory(
  params: BatchWorkflowBaseParams,
  deps: BatchWorkflowDeps
): Promise<BatchWorkflowRunResult | null> {
  const story = await deps.runStoryGeneration(params)
  if (!story.success) {
    return {
      success: false,
      stage: 'story',
      message: story.error || '剧情拆解批次生成失败',
      result: story
    }
  }

  let storyReview = await deps.runStoryReview(params)
  const maxRetries = normalizeMaxRetries(params.maxRetries)
  for (
    let retry = 1;
    !storyReview.success && storyReview.review?.feedback && retry <= maxRetries;
    retry++
  ) {
    const retryStory = await deps.runStoryGeneration({
      ...params,
      reviewFeedback: storyReview.review.feedback
    })
    if (!retryStory.success) {
      return {
        success: false,
        stage: 'story',
        message: retryStory.error || '剧情拆解批次按反馈重写失败',
        result: retryStory
      }
    }
    storyReview = await deps.runStoryReview(params)
  }
  if (!storyReview.success) {
    return {
      success: false,
      stage: 'story_review',
      message: storyReview.error || '剧情拆解批次审核未通过',
      result: storyReview
    }
  }

  return null
}

async function runStoryInventoryCycle(
  params: BatchWorkflowBaseParams,
  deps: BatchWorkflowDeps
): Promise<BatchWorkflowRunResult> {
  const storyFailure = await ensureStoryInventory(params, deps)
  if (storyFailure) return storyFailure
  return {
    success: true,
    stage: 'story',
    message: '剧情拆解批次已入库'
  }
}

export async function runBatchWorkflowMode(
  mode: BatchMode,
  params: BatchWorkflowBaseParams,
  deps: BatchWorkflowDeps
): Promise<BatchWorkflowRunResult> {
  if (mode === 'smart_next') {
    if (params.plotBreakdown?.nextActionMode === 'breakdown') {
      return await runStoryInventoryCycle(params, deps)
    }
    if (params.plotBreakdown?.nextActionMode === 'script') {
      return await runBatchWorkflowMode('preproduction', params, deps)
    }
    return {
      success: true,
      stage: 'smart_next',
      message: '目标范围已完成，无需继续执行'
    }
  }

  if (mode === 'story_until_ready' || mode === 'story_until_done') {
    return await runStoryInventoryCycle(params, deps)
  }

  if (mode === 'script_until_empty') {
    return await runBatchWorkflowMode('preproduction', params, deps)
  }

  if (mode !== 'preproduction') {
    const result = await runWorkflowStep(mode, params, deps)
    const label = MODE_MAP[mode].label
    return {
      success: result.success,
      stage: mode,
      message: result.success ? `${label}完成` : result.error || `${label}失败`,
      result
    }
  }

  let script = await deps.runScriptGeneration(params)
  if (!script.success && isMissingStoryInventory(script)) {
    const storyFailure = await ensureStoryInventory(params, deps)
    if (storyFailure) return storyFailure
    script = await deps.runScriptGeneration(params)
  }
  if (!script.success) {
    return {
      success: false,
      stage: 'script',
      message: script.error || '剧本生成失败',
      result: script
    }
  }

  let scriptReview = await deps.runScriptReview(params)
  const maxRetries = normalizeMaxRetries(params.maxRetries)
  for (
    let retry = 1;
    !scriptReview.success && scriptReview.review?.feedback && retry <= maxRetries;
    retry++
  ) {
    const retryScript = await deps.runScriptGeneration({
      ...params,
      reviewFeedback: scriptReview.review.feedback
    })
    if (!retryScript.success) {
      return {
        success: false,
        stage: 'script',
        message: retryScript.error || '剧本按反馈重写失败',
        result: retryScript
      }
    }
    scriptReview = await deps.runScriptReview(params)
  }
  if (!scriptReview.success) {
    return {
      success: false,
      stage: 'script_review',
      message: scriptReview.error || '剧本审核未通过',
      result: scriptReview
    }
  }

  return {
    success: true,
    stage: 'preproduction',
    message: '库存到剧审完成',
    result: scriptReview
  }
}

function normalizeMaxRetries(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.floor(Number(value)))
}

export function isBatchRunSuccess(
  result: ServicePipelineStartResult,
  mode: BatchMode
): boolean {
  if (!isServiceSuccess(result)) return false
  if (mode === 'full') {
    return result.state === 'episode_complete'
  }
  return result.state === `${MODE_MAP[mode].stage}_done`
}

export function resolveBatchRunProgress(
  result: ServicePipelineStartResult | BatchWorkflowRunResult,
  mode: BatchMode,
  elapsed: number
): { status: 'done' | 'error'; progress: string; elapsed: number } {
  if (isWorkflowBatchMode(mode)) {
    const message =
      'message' in result ? result.message : result.success ? '完成' : '执行失败'
    return {
      status: result.success ? 'done' : 'error',
      progress: `${message} (${elapsed}s)`,
      elapsed
    }
  }

  if (isBatchRunSuccess(result, mode)) {
    return {
      status: 'done',
      progress: `完成 (${elapsed}s)`,
      elapsed
    }
  }

  return {
    status: 'error',
    progress: getServiceErrorMessage(
      result,
      result.state ? `失败: ${result.state}` : '执行失败'
    ),
    elapsed
  }
}

export function resolveBatchRunException(error: unknown): string {
  return getExceptionMessage(error, '执行异常')
}
