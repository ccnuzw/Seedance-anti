// ============================================================
// Project State Persistence — 项目状态持久化
// ============================================================
// 将流水线运行快照和审核记录写入 outputs/pipeline-state.json，
// 重启应用后至少可恢复到一致的"最后已知状态"。

import { join, dirname } from 'path'
import type { PipelineContext, PipelineStage, PipelineState, ReviewResult, EpisodeStatus } from '@shared/types'
import { writeArtifactJson } from '../project/artifact-service'
import {
  PROJECT_STATE_VERSION,
  ensureProjectDataFile,
  normalizeProjectStateContent
} from '../project/project-data-compat'

export interface EpisodeState {
  episodeNum: number
  status: EpisodeStatus
  lastStage: PipelineStage
  completedStages: PipelineStage[]
  reviews: ReviewResult[]
  totalDurationSeconds: number
  updatedAt: string
}

export interface ProjectState {
  version: number
  projectId: string
  runtime?: PipelineRuntimeSnapshot
  episodes: Record<number, EpisodeState>
  updatedAt: string
}

export interface PipelineRuntimeSnapshot {
  context: PipelineContext
  status: 'running' | 'paused' | 'terminal'
  updatedAt: string
}

function cloneContext(context: PipelineContext): PipelineContext {
  return {
    ...context,
    reviews: [...context.reviews],
    logs: [...context.logs]
  }
}

function getRuntimeStatus(state: PipelineState): PipelineRuntimeSnapshot['status'] {
  if (state === 'paused') return 'paused'
  if (['idle', 'director_done', 'art_done', 'episode_complete', 'error'].includes(state)) {
    return 'terminal'
  }
  return 'running'
}

export async function readProjectStateFile(projectPath: string): Promise<ProjectState | null> {
  const result = await ensureProjectDataFile<ProjectState>(projectPath, 'projectState')
  return result.data
}

export function recoverPipelineContext(state: ProjectState | null): PipelineContext | null {
  const runtime = state?.runtime
  if (!runtime) return null

  const context = cloneContext(runtime.context)
  if (runtime.status !== 'running') {
    return context
  }

  return {
    ...context,
    state: 'error',
    error: context.error || '上次流水线运行在应用退出前中断，当前仅恢复最后快照，无法继续执行'
  }
}

export class ProjectStatePersistence {
  private filePath: string
  private state: ProjectState

  constructor(projectPath: string, projectId: string) {
    this.filePath = join(projectPath, 'outputs', 'pipeline-state.json')
    this.state = {
      version: PROJECT_STATE_VERSION,
      projectId,
      episodes: {},
      updatedAt: new Date().toISOString()
    }
  }

  /** 从磁盘加载（不存在则返回空状态） */
  async load(): Promise<ProjectState> {
    const result = await ensureProjectDataFile<ProjectState>(dirname(dirname(this.filePath)), 'projectState')
    if (result.data) {
      this.state = normalizeProjectStateContent(result.data, this.state.projectId) as ProjectState
    }
    return this.state
  }

  /** 保存到磁盘 */
  async save(): Promise<void> {
    this.state.updatedAt = new Date().toISOString()
    this.state.version = PROJECT_STATE_VERSION
    await writeArtifactJson({
      projectPath: dirname(dirname(this.filePath)),
      kind: 'pipeline_state',
      filePath: this.filePath,
      content: this.state,
      label: '运行状态快照',
      createdBy: 'system'
    })
  }

  /** 更新最近一次运行快照 */
  async updateRuntime(context: PipelineContext): Promise<void> {
    this.state.runtime = {
      context: cloneContext(context),
      status: getRuntimeStatus(context.state),
      updatedAt: new Date().toISOString()
    }

    await this.save()
  }

  /** 更新单集状态 */
  async updateEpisode(
    episodeNum: number,
    update: Partial<EpisodeState>
  ): Promise<void> {
    const existing = this.state.episodes[episodeNum] || {
      episodeNum,
      status: 'idle' as EpisodeStatus,
      lastStage: 'director' as PipelineStage,
      completedStages: [],
      reviews: [],
      totalDurationSeconds: 0,
      updatedAt: new Date().toISOString()
    }

    this.state.episodes[episodeNum] = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    }

    await this.save()
  }

  /** 标记阶段完成 */
  async markStageComplete(
    episodeNum: number,
    stage: PipelineStage,
    reviews: ReviewResult[]
  ): Promise<void> {
    const existing = this.state.episodes[episodeNum]
    const completedStages = existing?.completedStages || []
    if (!completedStages.includes(stage)) {
      completedStages.push(stage)
    }

    const existingReviews = existing?.reviews || []
    const mergedReviews = [...existingReviews]
    for (const review of reviews) {
      const hasDuplicate = mergedReviews.some(
        (item) =>
          item.createdAt === review.createdAt &&
          item.stage === review.stage &&
          item.result === review.result
      )
      if (!hasDuplicate) {
        mergedReviews.push(review)
      }
    }

    const statusMap: Record<PipelineStage, EpisodeStatus> = {
      director: 'director',
      art: 'art',
      storyboard: 'complete'
    }

    await this.updateEpisode(episodeNum, {
      lastStage: stage,
      completedStages,
      reviews: mergedReviews,
      status: statusMap[stage]
    })
  }

  /** 追加单条审核记录，即使阶段未完成也保留审计轨迹 */
  async appendReview(
    episodeNum: number,
    review: ReviewResult,
    stage: PipelineStage
  ): Promise<void> {
    const existing = this.state.episodes[episodeNum]
    const existingReviews = existing?.reviews || []
    const hasDuplicate = existingReviews.some(
      (item) =>
        item.createdAt === review.createdAt &&
        item.stage === review.stage &&
        item.result === review.result
    )

    await this.updateEpisode(episodeNum, {
      lastStage: stage,
      reviews: hasDuplicate ? existingReviews : [...existingReviews, review],
      status: stage === 'storyboard' ? 'storyboard' : existing?.status
    })
  }

  /** 获取单集状态 */
  getEpisode(episodeNum: number): EpisodeState | undefined {
    return this.state.episodes[episodeNum]
  }

  /** 获取最近一次运行快照 */
  getRuntime(): PipelineRuntimeSnapshot | undefined {
    return this.state.runtime
  }

  /** 获取全部状态 */
  getState(): ProjectState {
    return this.state
  }
}
