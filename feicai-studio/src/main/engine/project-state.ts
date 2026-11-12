// ============================================================
// Project State Persistence — 项目状态持久化
// ============================================================

import { atomicWriteFile, readJsonWithRecovery } from '../io/atomic-file'
import { assertPathWithinProject } from '../security/access-control'
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
import {
  assertNoPreparedProductionWrites,
  readCommitText,
  type CommitWrite
} from '../io/production-commit-store'
import { deriveEpisodeStatusFromStage } from './state-machine-meta'
import type { AutomatedPipelineStage } from '@shared/types'

type StageSnapshotUpdate = Partial<
  Omit<EpisodeStageSnapshot, 'stage' | 'updatedAt'>
> & {
  status?: EpisodeStageSnapshot['status']
}

const stateMutations = new Map<string, Promise<void>>()

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

/** Saved history is portable; absolute paths and identity are not trusted on restore. */
export function normalizeSavedProjectState(
  state: ProjectPipelineState,
  projectPath: string,
  projectId: string
): ProjectPipelineState {
  if (!state.episodes || typeof state.episodes !== 'object')
    throw new Error('项目流水线状态格式损坏')
  state.projectId = projectId
  for (const episode of Object.values(state.episodes)) {
    for (const snapshot of Object.values(episode.stageStates || {})) {
      if (!snapshot) continue
      for (const key of ['outputPath', 'reviewPath'] as const) {
        const savedPath = snapshot[key]
        if (!savedPath) continue
        try {
          snapshot[key] = assertPathWithinProject(projectPath, savedPath)
        } catch {
          snapshot[key] = undefined
        }
      }
    }
  }
  return state
}

export class ProjectStatePersistence {
  private filePath: string
  private state: ProjectPipelineState

  constructor(
    private readonly projectPath: string,
    private readonly projectId: string,
    private readonly config?: Partial<ProjectConfig> | null
  ) {
    this.filePath = assertPathWithinProject(
      projectPath,
      resolveProjectArtifactPath(projectPath, 'pipelineState', config)
    )
    this.state = {
      projectId,
      episodes: {},
      updatedAt: new Date().toISOString()
    }
  }

  async load(): Promise<ProjectPipelineState> {
    const state = await readJsonWithRecovery<ProjectPipelineState>(
      this.filePath,
      { readOnly: true }
    )
    if (state) {
      if (
        !state.episodes ||
        typeof state.episodes !== 'object' ||
        typeof state.projectId !== 'string'
      ) {
        throw new Error('项目流水线状态格式损坏')
      }
      this.state = normalizeSavedProjectState(
        state,
        this.projectPath,
        this.projectId
      )
    }
    return this.state
  }

  async save(): Promise<void> {
    assertNoPreparedProductionWrites(this.projectPath, this.config)
    this.state.updatedAt = new Date().toISOString()
    await atomicWriteFile(this.filePath, JSON.stringify(this.state, null, 2))
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
    await this.mutateEpisode(episodeNum, (existing) => ({
      ...existing,
      ...update
    }))
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

  /** Prepare portable state bytes without touching disk or the live instance. */
  prepareReviewCommit(
    episodeNum: number,
    stage: AutomatedPipelineStage,
    review: ReviewResult,
    operationId?: string
  ): CommitWrite {
    const expected = readCommitText(this.filePath)
    const state =
      expected === null
        ? ({
            projectId: this.projectId,
            episodes: {},
            updatedAt: review.createdAt
          } as ProjectPipelineState)
        : normalizeSavedProjectState(
            JSON.parse(expected),
            this.projectPath,
            this.projectId
          )
    const existing =
      state.episodes[episodeNum] || createEmptyEpisodeState(episodeNum)
    const current = existing.stageStates[stage]
    if (review.stage !== (stage === 'storyboard' ? 'storyboard_review' : stage))
      throw new Error('审核收据阶段不匹配')
    const duplicate = existing.reviews.find(
      (r) => r.stage === review.stage && r.createdAt === review.createdAt
    )
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(review))
      throw new Error('审核收据身份重复但内容不同')
    state.episodes[episodeNum] = {
      ...existing,
      status: review.passed
        ? deriveEpisodeStatusFromStage(stage)
        : existing.status,
      lastStage: stage,
      updatedAt: review.createdAt,
      reviews: duplicate ? existing.reviews : [...existing.reviews, review],
      completedStages: review.passed
        ? Array.from(new Set([...existing.completedStages, stage]))
        : existing.completedStages.filter((s) => s !== stage),
      stageStates: {
        ...existing.stageStates,
        [stage]: {
          ...current,
          stage,
          status: review.passed ? 'passed' : 'failed',
          attempts: current?.attempts || 0,
          operationId,
          completedAt: review.createdAt,
          updatedAt: review.createdAt,
          lastReview: review,
          lastError: review.passed ? undefined : review.feedback
        }
      }
    }
    state.updatedAt = review.createdAt
    return {
      path: this.filePath,
      expected,
      content: JSON.stringify(state, null, 2)
    }
  }

  async markStageReviewResult(
    episodeNum: number,
    stage: PipelineStage,
    review: ReviewResult,
    extra: {
      reviewPath?: string
      outputPath?: string
      operationId?: string
    } = {}
  ): Promise<void> {
    // A publication may already have installed this exact review and status.
    await this.load()
    const episode = this.state.episodes[episodeNum]
    if (review.stage !== (stage === 'storyboard' ? 'storyboard_review' : stage))
      throw new Error('审核收据阶段不匹配')
    const duplicate = episode?.reviews.find(
      (r) => r.stage === review.stage && r.createdAt === review.createdAt
    )
    if (duplicate) {
      const snapshot = episode.stageStates[stage]
      if (
        JSON.stringify(duplicate) !== JSON.stringify(review) ||
        snapshot?.lastReview?.createdAt !== review.createdAt ||
        snapshot?.operationId !== extra.operationId
      )
        throw new Error('审核收据身份、阶段或内容冲突')
      return
    }
    for (const other of Object.values(this.state.episodes)) {
      if (
        other.episodeNum !== episodeNum &&
        other.reviews.some((r) => JSON.stringify(r) === JSON.stringify(review))
      )
        throw new Error('审核收据不能跨集复用')
    }
    // Read/merge review history inside the per-path transaction, not a stale instance snapshot.
    await this.updateStageSnapshot(
      episodeNum,
      stage,
      {
        status: review.passed ? 'passed' : 'failed',
        completedAt: review.createdAt,
        reviewPath: extra.reviewPath,
        outputPath: extra.outputPath,
        lastReview: review,
        operationId: extra.operationId,
        lastError: review.passed ? undefined : review.feedback
      },
      (existing) => ({
        lastStage: stage,
        reviews: [...existing.reviews, review],
        completedStages: review.passed
          ? Array.from(new Set([...(existing.completedStages || []), stage]))
          : (existing.completedStages || []).filter(
              (completed) => completed !== stage
            )
      })
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
      (existing) => ({
        lastStage: stage,
        completedStages: Array.from(
          new Set([...(existing.completedStages || []), stage])
        )
      })
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

  private async mutateEpisode(
    episodeNum: number,
    update: (existing: EpisodePipelineState) => EpisodePipelineState
  ): Promise<void> {
    const previous = stateMutations.get(this.filePath) || Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        await this.load()
        const existing =
          this.state.episodes[episodeNum] || createEmptyEpisodeState(episodeNum)
        this.state.episodes[episodeNum] = {
          ...update(existing),
          updatedAt: new Date().toISOString()
        }
        await this.save()
      })
    stateMutations.set(this.filePath, operation)
    try {
      await operation
    } finally {
      if (stateMutations.get(this.filePath) === operation)
        stateMutations.delete(this.filePath)
    }
  }

  private async updateStageSnapshot(
    episodeNum: number,
    stage: PipelineStage,
    update: StageSnapshotUpdate,
    episodeUpdate:
      | Partial<EpisodePipelineState>
      | ((existing: EpisodePipelineState) => Partial<EpisodePipelineState>) = {}
  ): Promise<void> {
    await this.mutateEpisode(episodeNum, (existing) => {
      const current = existing.stageStates[stage]
      const snapshot: EpisodeStageSnapshot = {
        ...current,
        ...update,
        stage,
        status: update.status || current?.status || 'pending',
        attempts:
          (current?.attempts || 0) + (update.status === 'running' ? 1 : 0),
        updatedAt: new Date().toISOString(),
        outputPath: update.outputPath ?? current?.outputPath,
        reviewPath: update.reviewPath ?? current?.reviewPath,
        lastReview: update.lastReview ?? current?.lastReview
      }
      return {
        ...existing,
        ...(typeof episodeUpdate === 'function'
          ? episodeUpdate(existing)
          : episodeUpdate),
        stageStates: { ...existing.stageStates, [stage]: snapshot }
      }
    })
  }
}
