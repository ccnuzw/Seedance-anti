// ============================================================
// Project State Persistence — 项目状态持久化
// ============================================================
// 将流水线进度和审核记录写入 outputs/pipeline-state.json，
// 重启应用后可恢复进度。

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import type { PipelineStage, ReviewResult, EpisodeStatus } from '@shared/types'

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
  projectId: string
  episodes: Record<number, EpisodeState>
  updatedAt: string
}

export class ProjectStatePersistence {
  private filePath: string
  private state: ProjectState

  constructor(projectPath: string, projectId: string) {
    this.filePath = join(projectPath, 'outputs', 'pipeline-state.json')
    this.state = {
      projectId,
      episodes: {},
      updatedAt: new Date().toISOString()
    }
  }

  /** 从磁盘加载（不存在则返回空状态） */
  async load(): Promise<ProjectState> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      this.state = JSON.parse(raw) as ProjectState
    } catch {
      // 文件不存在，保持默认空状态
    }
    return this.state
  }

  /** 保存到磁盘 */
  async save(): Promise<void> {
    this.state.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
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

    const statusMap: Record<PipelineStage, EpisodeStatus> = {
      director: 'director',
      art: 'art',
      storyboard: 'complete'
    }

    await this.updateEpisode(episodeNum, {
      lastStage: stage,
      completedStages,
      reviews: [...(existing?.reviews || []), ...reviews],
      status: statusMap[stage]
    })
  }

  /** 获取单集状态 */
  getEpisode(episodeNum: number): EpisodeState | undefined {
    return this.state.episodes[episodeNum]
  }

  /** 获取全部状态 */
  getState(): ProjectState {
    return this.state
  }
}
