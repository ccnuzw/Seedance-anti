import type { ProjectConfig } from '@shared/types'
import type { ProductionCommitRecord } from '@shared/production-commit'
import { updateProjectRecord } from '../db/project-repository'
import {
  ProductionCommitStore,
  type CommitWrite
} from '../io/production-commit-store'
import { assertPathWithinProject } from '../security/access-control'
import {
  acquireExecutionLease,
  releaseExecutionLease,
  type ExecutionLease
} from './batch-execution-lease'

/** Logs travel with a project. Local database identity must be resolved anew. */
async function projectionBinding(projectPath: string, projectId?: string) {
  const { listProjects } = await import('../db/project-repository')
  const root = assertPathWithinProject(projectPath, projectPath)
  const project = listProjects().find((project) => {
    if (projectId && project.id !== projectId) return false
    try {
      return (
        assertPathWithinProject(project.projectPath, project.projectPath) ===
        root
      )
    } catch {
      return false
    }
  })
  if (!project) throw new Error('生产提交恢复要求当前登记项目与真实路径匹配')
  return project
}

export async function recoverProductionCommits(
  projectPath: string,
  config?: Partial<ProjectConfig> | null,
  existingLease?: ExecutionLease,
  projectId?: string,
  project?: (
    episodes: number[],
    record: ProductionCommitRecord
  ) => Promise<void>
): Promise<void> {
  const lease = acquireExecutionLease('production-recovery', existingLease)
  try {
    const store = new ProductionCommitStore(projectPath, config)
    if (
      !store
        .list()
        .some(
          (record) =>
            record.phase === 'prepared' ||
            (record.phase === 'committed' && !record.projected)
        )
    )
      return
    const boundProject = await projectionBinding(projectPath, projectId)
    const { syncFreshProductionEpisodes } =
      await import('../db/episode-sync-repository')
    await store.recover(
      project ||
        (async (episodes, record) => {
          if (record.kind === 'project-settings') {
            const result = record.result as {
              id: string
              name: string
              visualStyle: string
              targetMedium: string
              totalEpisodes: number
              configJson: string
              updatedAt: string
            }
            if (result.id !== boundProject.id)
              throw new Error('项目设置提交投影身份不一致')
            updateProjectRecord(result)
            return
          }
          await syncFreshProductionEpisodes(
            boundProject.id,
            projectPath,
            episodes
          )
        })
    )
  } finally {
    if (!existingLease) releaseExecutionLease(lease)
  }
}

/** Controlled extension point for future manifest updates. The IO layer always
 * calls decodeProductionManifestUpdate before persisting a manifest write. */
export async function commitProductionFiles(params: {
  projectPath: string
  projectId: string
  config?: Partial<ProjectConfig> | null
  operationId: string
  key: string
  inputHash: string
  episodeNumbers: number[]
  writes: CommitWrite[]
  lease?: ExecutionLease
  project?: (
    episodes: number[],
    record: ProductionCommitRecord
  ) => Promise<void>
  kind?: 'production' | 'project-settings'
  result?: unknown
}): Promise<void> {
  const lease = acquireExecutionLease('production-commit', params.lease)
  try {
    await recoverProductionCommits(
      params.projectPath,
      params.config,
      lease,
      params.projectId,
      params.project
    )
    const store = new ProductionCommitStore(params.projectPath, params.config)
    await projectionBinding(params.projectPath, params.projectId)
    const intent = await store.intent(
      params.operationId,
      params.key,
      params.inputHash,
      params.episodeNumbers,
      [],
      params.kind,
      params.result
    )
    if (intent.phase === 'intent')
      await store.install(
        await store.prepare(intent, params.writes, params.result)
      )
    await recoverProductionCommits(
      params.projectPath,
      params.config,
      lease,
      params.projectId,
      params.project
    )
  } finally {
    if (!params.lease) releaseExecutionLease(lease)
  }
}
