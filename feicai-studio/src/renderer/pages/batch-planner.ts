import type {
  PipelineBatchMode,
  PipelineDependencyCondition,
  PipelineRunPriority,
  PipelineStage,
  ProjectTaskTemplate
} from '@shared/types'

export type BatchMode = 'full' | 'director' | 'art' | 'storyboard'

export interface BatchPlanRequest {
  episodeNum: number
  startStage?: PipelineStage
  singleStage: boolean
  strategy: {
    batchId: string
    batchLabel: string
    priority: PipelineRunPriority
    maxAutoRetries: number
    templateId?: string
    templateLabel?: string
  }
  orchestration: {
    dependsOnRootRunId?: string
    condition: PipelineDependencyCondition
    scheduledAt?: string
  }
}

export interface BatchPlanResult {
  batchId: string
  batchLabel: string
  scheduledAtIso?: string
  startStage?: PipelineStage
  singleStage: boolean
  requests: BatchPlanRequest[]
}

export const BATCH_MODE_MAP: Record<BatchMode, { label: string; emoji: string; stage?: PipelineStage }> = {
  full: { label: '全流程', emoji: '🚀' },
  director: { label: '导演分析', emoji: '🎬', stage: 'director' },
  art: { label: '服化道', emoji: '🎨', stage: 'art' },
  storyboard: { label: '分镜编写', emoji: '📐', stage: 'storyboard' }
}

export function resolveScheduledAtInput(value: string): { scheduledAtIso?: string; error?: string } {
  if (!value) return {}
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { error: '定时时间格式无效' }
  }
  return { scheduledAtIso: parsed.toISOString() }
}

export function resolveBatchExecution(
  mode: BatchMode,
  template?: ProjectTaskTemplate | null
): {
  startStage?: PipelineStage
  singleStage: boolean
} {
  const startStage = BATCH_MODE_MAP[mode].stage
  const templateMatchesStage = !!template?.startStage && template.startStage === startStage
  return {
    startStage,
    singleStage: templateMatchesStage
      ? !!template.singleStage
      : !!startStage
  }
}

export function buildBatchPlan(input: {
  selectedEpisodes: number[]
  mode: BatchMode
  batchMode: PipelineBatchMode
  batchLabel: string
  priority: PipelineRunPriority
  maxAutoRetries: number
  scheduledAt?: string
  selectedTemplate?: ProjectTaskTemplate | null
  batchId: string
}): BatchPlanResult {
  const sortedEpisodes = [...input.selectedEpisodes].sort((a, b) => a - b)
  const { scheduledAtIso, error } = resolveScheduledAtInput(input.scheduledAt || '')
  if (error) {
    throw new Error(error)
  }

  const { startStage, singleStage } = resolveBatchExecution(input.mode, input.selectedTemplate)
  let previousRootRunId: string | undefined

  const requests = sortedEpisodes.map((episodeNum) => {
    const dependencyCondition: PipelineDependencyCondition = input.batchMode === 'sequential_on_success'
      ? 'on_success'
      : 'always'
    const request: BatchPlanRequest = {
      episodeNum,
      startStage,
      singleStage,
      strategy: {
        batchId: input.batchId,
        batchLabel: input.batchLabel,
        priority: input.priority,
        maxAutoRetries: input.maxAutoRetries,
        templateId: input.selectedTemplate?.id,
        templateLabel: input.selectedTemplate?.label
      },
      orchestration: {
        dependsOnRootRunId: input.batchMode === 'independent' ? undefined : previousRootRunId,
        condition: dependencyCondition,
        scheduledAt: scheduledAtIso
      }
    }
    previousRootRunId = `planned-root-${episodeNum}`
    return request
  })

  return {
    batchId: input.batchId,
    batchLabel: input.batchLabel,
    scheduledAtIso,
    startStage,
    singleStage,
    requests
  }
}
