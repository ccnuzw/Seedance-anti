import type { ProjectConfig } from '@shared/types'
import type {
  ProductionCommitKind,
  ProductionCommitRecord
} from '@shared/production-commit'
import {
  ProductionCommitStore,
  type CommitWrite
} from '../io/production-commit-store'
import { assertPathWithinProject } from '../security/access-control'
import {
  acquireExecutionLease,
  getExecutionLease,
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

export async function recoverProjectCommits(
  kind: ProductionCommitKind,
  projectPath: string,
  config?: Partial<ProjectConfig> | null,
  existingLease?: ExecutionLease,
  projectId?: string,
  project?: (
    episodes: number[],
    record: ProductionCommitRecord
  ) => Promise<void>
): Promise<void> {
  const lease = acquireExecutionLease(`${kind}-recovery`, existingLease)
  try {
    const store = new ProductionCommitStore(projectPath, config)
    if (
      !store
        .list(kind)
        .some(
          (record) =>
            record.phase === 'prepared' ||
            (record.phase === 'committed' && !record.projected)
        )
    )
      return
    if (project) {
      await store.recover(project, kind)
    } else {
      const binding = await projectionBinding(projectPath, projectId)
      const { syncFreshProductionEpisodes } =
        await import('../db/episode-sync-repository')
      await store.recover(
        (episodes) =>
          syncFreshProductionEpisodes(binding.id, projectPath, episodes),
        kind
      )
    }
  } finally {
    if (!existingLease) releaseExecutionLease(lease)
  }
}

export async function recoverProductionCommits(
  projectPath: string,
  config?: Partial<ProjectConfig> | null,
  existingLease?: ExecutionLease,
  projectId?: string
): Promise<void> {
  const lease = acquireExecutionLease('project-recovery', existingLease)
  try {
    await recoverProjectCommits(
      'production',
      projectPath,
      config,
      lease,
      projectId
    )
    await recoverProjectSettingsAtBoundary(
      projectPath,
      config,
      lease,
      projectId
    )
  } finally {
    if (!existingLease) releaseExecutionLease(lease)
  }
}

export async function recoverProjectSettingsCommits(
  projectPath: string,
  config?: Partial<ProjectConfig> | null,
  existingLease?: ExecutionLease,
  projectId?: string,
  project?: (
    episodes: number[],
    record: ProductionCommitRecord
  ) => Promise<void>
): Promise<void> {
  const projection =
    project ||
    (async (episodes: number[], record: ProductionCommitRecord) => {
      const service = await import('./project-service')
      await service.projectSettingsRecord(episodes, record)
    })
  return recoverProjectCommits(
    'project-settings',
    projectPath,
    config,
    existingLease,
    projectId,
    projection
  )
}

/** Reconcile settings before ordinary production work at a shared recovery boundary. */
export async function recoverProjectSettingsAtBoundary(
  projectPath: string,
  config?: Partial<ProjectConfig> | null,
  existingLease?: ExecutionLease,
  projectId?: string
): Promise<void> {
  return recoverProjectSettingsCommits(
    projectPath,
    config,
    existingLease || getExecutionLease() || undefined,
    projectId
  )
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
}): Promise<void> {
  const lease = acquireExecutionLease('production-commit', params.lease)
  try {
    await recoverProductionCommits(
      params.projectPath,
      params.config,
      lease,
      params.projectId
    )
    const store = new ProductionCommitStore(params.projectPath, params.config)
    await projectionBinding(params.projectPath, params.projectId)
    const intent = await store.intent(
      params.operationId,
      params.key,
      params.inputHash,
      params.episodeNumbers
    )
    if (intent.phase === 'intent')
      await store.install(await store.prepare(intent, params.writes))
    await recoverProductionCommits(
      params.projectPath,
      params.config,
      lease,
      params.projectId
    )
  } finally {
    if (!params.lease) releaseExecutionLease(lease)
  }
}
