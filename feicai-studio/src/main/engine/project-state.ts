// ============================================================
// Project State Persistence — 项目状态持久化
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type {
  EpisodePipelineState,
  EpisodeStatus,
  EpisodeStageSnapshot,
  PipelineStage,
  ProjectConfig,
  ProjectPipelineState,
  ReviewResult
} from '@shared/types'
import { resolveProjectArtifactPath } from '@shared/path-resolver'

type StageSnapshotUpdate = Partial<
  Omit<EpisodeStageSnapshot, 'stage' | 'updatedAt'>
> & {
  status?: EpisodeStageSnapshot['status']
}

function createEmptyEpisodeState(episodeNum: number): EpisodePipelineState {
  const now = new Date().toISOString()
  return {
    episodeNum,
    status: 'idle' as EpisodeStatus,
    lastStage: 'director' as PipelineStage,
    completedStages: [],
    stageStates: {},
    reviews: [],
    totalDurationSeconds: 0,
    updatedAt: now
  }
}

export class ProjectStatePersistence {
  private filePath: string
  private state: ProjectPipelineState

  constructor(
    projectPath: string,
    projectId: string,
    config?: Partial<ProjectConfig> | null
  ) {
    this.filePath = resolveProjectArtifactPath(
      projectPath,
      'pipelineState',
      config
    )
    this.state = {
      projectId,
      episodes: {},
      updatedAt: new Date().toISOString()
    }
  }

  async load(): Promise<ProjectPipelineState> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      this.state = JSON.parse(raw) as ProjectPipelineState
    } catch {
      // ignore missing state file
    }
    return this.state
  }

  async save(): Promise<void> {
    this.state.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  getEpisode(episodeNum: number): EpisodePipelineState | undefined {
    return this.state.episodes[episodeNum]
  }

  getState(): ProjectPipelineState {
    return this.state
  }

  async updateEpisode(
    episodeNum: number,
    update: Partial<EpisodePipelineState>
  ): Promise<void> {
    const existing =
      this.state.episodes[episodeNum] || createEmptyEpisodeState(episodeNum)
    this.state.episodes[episodeNum] = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    }
    await this.save()
  }

  async markStageRunning(
    episodeNum: number,
    stage: PipelineStage,
    extra: { outputPath?: string } = {}
  ): Promise<void> {
    await this.updateStageSnapshot(
      episodeNum,
      stage,
      {
        status: 'running',
        startedAt: new Date().toISOString(),
        outputPath: extra.outputPath,
        lastError: undefined
      },
      {
        lastStage: stage
      }
    )
  }

  async markStageReviewResult(
    episodeNum: number,
    stage: PipelineStage,
    review: ReviewResult,
    extra: { reviewPath?: string; outputPath?: string } = {}
  ): Promise<void> {
    const existing =
      this.state.episodes[episodeNum] || createEmptyEpisodeState(episodeNum)
    const reviews = [...existing.reviews]
    reviews.push(review)

    await this.updateStageSnapshot(
      episodeNum,
      stage,
      {
        status: review.passed ? 'passed' : 'failed',
        completedAt: review.createdAt,
        reviewPath: extra.reviewPath,
        outputPath: extra.outputPath,
        lastReview: review,
        lastError: review.passed ? undefined : review.feedback
      },
      {
        lastStage: stage,
        reviews,
        completedStages: review.passed
          ? Array.from(new Set([...(existing.completedStages || []), stage]))
          : existing.completedStages
      }
    )
  }

  async markStageSkipped(
    episodeNum: number,
    stage: PipelineStage
  ): Promise<void> {
    await this.updateStageSnapshot(
      episodeNum,
      stage,
      {
        status: 'skipped',
        completedAt: new Date().toISOString(),
        lastError: undefined
      },
      {
        lastStage: stage,
        completedStages: Array.from(
          new Set([
            ...(this.getEpisode(episodeNum)?.completedStages || []),
            stage
          ])
        )
      }
    )
  }

  async markStageError(
    episodeNum: number,
    stage: PipelineStage,
    error: string
  ): Promise<void> {
    await this.updateStageSnapshot(
      episodeNum,
      stage,
      {
        status: 'failed',
        completedAt: new Date().toISOString(),
        lastError: error
      },
      {
        lastStage: stage
      }
    )
  }

  async updateEpisodeStatus(
    episodeNum: number,
    status: EpisodeStatus,
    extra: { totalDurationSeconds?: number } = {}
  ): Promise<void> {
    await this.updateEpisode(episodeNum, {
      status,
      ...(extra.totalDurationSeconds !== undefined
        ? { totalDurationSeconds: extra.totalDurationSeconds }
        : {})
    })
  }

  private async updateStageSnapshot(
    episodeNum: number,
    stage: PipelineStage,
    update: StageSnapshotUpdate,
    episodeUpdate: Partial<EpisodePipelineState> = {}
  ): Promise<void> {
    const existing =
      this.state.episodes[episodeNum] || createEmptyEpisodeState(episodeNum)
    const current = existing.stageStates[stage]
    const attempts =
      update.status === 'running'
        ? (current?.attempts || 0) + 1
        : current?.attempts || 0

    const snapshot: EpisodeStageSnapshot = {
      stage,
      status: update.status || current?.status || 'pending',
      attempts,
      startedAt: update.startedAt ?? current?.startedAt,
      completedAt: update.completedAt ?? current?.completedAt,
      updatedAt: new Date().toISOString(),
      outputPath: update.outputPath ?? current?.outputPath,
      reviewPath: update.reviewPath ?? current?.reviewPath,
      lastError: update.lastError ?? current?.lastError,
      lastReview: update.lastReview ?? current?.lastReview
    }

    await this.updateEpisode(episodeNum, {
      ...episodeUpdate,
      stageStates: {
        ...existing.stageStates,
        [stage]: snapshot
      }
    })
  }
}
