import {
  createProject as createProjectRecord,
  deleteProject as deleteProjectRecord,
  getProject,
  listEpisodes,
  listProjects,
  migrateLegacyNovelDirectory as migrateLegacyNovelDirectoryRecord,
  repairProjectIssues as repairProjectIssuesRecord,
  resolveProjectUpdate,
  syncEpisodeStatus,
  syncSingleEpisodeStatus,
  updateProject as updateProjectRecord
} from '../db/queries'
import type { Episode, Project } from '@shared/types'
import type {
  PlotBreakdownSummary,
  SourceChapterItem,
  UpdateProjectInput
} from '@shared/ipc-contracts'
import { listSourceChapters } from '../project/novel-importer'
import { summarizeProjectPlotBreakdown } from '../project/plot-breakdown-store'
import {
  readCommitText,
  ProductionCommitStore,
  commitHash
} from '../io/production-commit-store'
import { updatePlotBreakdownPlanning } from '@shared/plot-breakdown'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { randomUUID } from 'crypto'
import { FileConflictError } from '../io/atomic-file'
import { updateProjectRecord as updateProjectProjection } from '../db/project-repository'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease
} from './batch-execution-lease'
import { recoverProjectSettingsCommits } from './production-commit-service'
import type { ProductionCommitRecord } from '@shared/production-commit'
import { assertPathWithinProject } from '../security/access-control'

export interface ProjectIdentity {
  projectId?: string
  projectPath?: string
}

export interface ProjectSyncParams {
  projectId: string
  projectPath: string
}

export interface ProjectEpisodeSyncParams extends ProjectSyncParams {
  episodeNum: number
}

export function listRegisteredProjects(): Project[] {
  return listProjects()
}

export function getRegisteredProject(id: string): Project | null {
  return getProject(id)
}

export function listRegisteredProjectSourceChapters(
  id: string
): SourceChapterItem[] {
  const project = getRegisteredProject(id)
  if (!project) return []
  return listSourceChapters({
    projectPath: project.projectPath,
    config: project.config,
    readOnly: true
  })
}

export function getRegisteredProjectPlotBreakdownSummary(
  id: string
): PlotBreakdownSummary {
  const project = getRegisteredProject(id)
  if (!project) {
    return {
      path: '',
      exists: false,
      totalEntries: 0,
      usedEntries: 0,
      unusedEntries: 0,
      totalBatches: 0,
      readyEpisodeCount: 0,
      readyEpisodeNumbers: [],
      usedEpisodeCount: 0,
      usedEpisodeNumbers: [],
      chapterStart: null,
      chapterEnd: null,
      nextBatchNumber: 1,
      targetChapterLimit: null,
      totalSourceChapters: 0,
      unprocessedChapterCount: null,
      overflowChapterCount: 0,
      waterlineStatus: 'done',
      nextActionLabel: '未找到项目',
      nextActionMode: 'done',
      breakdownProgressPct: 0,
      scriptProgressPct: 0,
      remainingBatchCount: 0,
      nextChapterStart: null,
      nextChapterEnd: null
    }
  }
  return summarizeProjectPlotBreakdown({
    projectPath: project.projectPath,
    config: project.config
  })
}

export function findRegisteredProject(
  identity: ProjectIdentity
): Project | null {
  if (identity.projectId) {
    return getRegisteredProject(identity.projectId)
  }

  if (!identity.projectPath) {
    return null
  }

  return (
    listProjects().find(
      (project) => project.projectPath === identity.projectPath
    ) || null
  )
}

export function getProjectByPath(projectPath: string): Project | undefined {
  return findRegisteredProject({ projectPath }) || undefined
}

export function resolveProjectConfig(
  identity: ProjectIdentity
): Partial<Project['config']> | null | undefined {
  return findRegisteredProject(identity)?.config
}

export async function createProject(data: {
  name: string
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  config: Partial<Project['config']>
  sourceNovelFilePath?: string
}): Promise<Project> {
  return await createProjectRecord(data)
}

export async function updateProject(
  id: string,
  data: {
    name?: string
    visualStyle?: string
    targetMedium?: string
    totalEpisodes?: number
    config?: Partial<Project['config']>
  }
): Promise<Project> {
  return await updateProjectRecord({ id, ...data })
}

interface SettingsProjection {
  projectId: string
  projectPath: string
  previous: {
    name: string
    visualStyle: string
    targetMedium: string
    totalEpisodes: number
    configJson: string
    updatedAt: string
  }
  next: {
    name: string
    visualStyle: string
    targetMedium: string
    totalEpisodes: number
    configJson: string
    updatedAt: string
  }
}

function settingsProjectionFromRecord(
  record: ProductionCommitRecord
): SettingsProjection {
  const result = record.result
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('项目设置提交投影损坏')
  const projection = result as Partial<SettingsProjection>
  if (
    typeof projection.projectId !== 'string' ||
    typeof projection.projectPath !== 'string' ||
    !projection.previous ||
    !projection.next
  )
    throw new Error('项目设置提交投影损坏')
  return projection as SettingsProjection
}

export async function projectSettingsRecord(
  _episodes: number[],
  record: ProductionCommitRecord
): Promise<void> {
  const projection = settingsProjectionFromRecord(record)
  const current = getRegisteredProject(projection.projectId)
  if (
    !current ||
    assertPathWithinProject(current.projectPath, current.projectPath) !==
      assertPathWithinProject(projection.projectPath, projection.projectPath)
  )
    throw new Error('项目设置恢复要求当前登记项目与真实路径匹配')

  const matches = (value: typeof projection.previous) =>
    current.name === value.name &&
    current.visualStyle === value.visualStyle &&
    current.targetMedium === value.targetMedium &&
    current.totalEpisodes === value.totalEpisodes &&
    JSON.stringify(current.config) === value.configJson &&
    current.updatedAt === value.updatedAt
  const alreadyProjected = matches(projection.next)
  if (alreadyProjected) return
  if (!matches(projection.previous)) throw new FileConflictError()
  updateProjectProjection({ id: current.id, ...projection.next })
}

export async function saveProjectSettings(
  id: string,
  data: UpdateProjectInput
): Promise<Project> {
  const initial = getRegisteredProject(id)
  if (!initial) throw new Error(`项目不存在: ${id}`)
  const existingLease = getExecutionLease()
  const lease = acquireExecutionLease(
    'project-settings',
    existingLease || undefined
  )
  const ownsLease = !existingLease
  try {
    await recoverProjectSettingsCommits(
      initial.projectPath,
      initial.config,
      lease,
      initial.id,
      projectSettingsRecord
    )
    const { currentProject, configPath, normalizedConfig, now } =
      resolveProjectUpdate({ id, ...data })
    const plotPath = resolveProjectArtifactPath(
      currentProject.projectPath,
      'plotBreakdown',
      currentProject.config
    )
    const currentConfig = readCommitText(configPath)
    const currentPlot = readCommitText(plotPath)
    const nextConfig = JSON.stringify(normalizedConfig, null, 2)
    let nextPlot: string | null = null
    if (currentPlot !== null) {
      nextPlot = updatePlotBreakdownPlanning(currentPlot, {
        projectName: normalizedConfig.projectName,
        projectType: normalizedConfig.targetMedium,
        totalEpisodes: normalizedConfig.totalEpisodes,
        chaptersPerEpisode: normalizedConfig.chaptersPerEpisode
      })
      if (nextPlot === currentPlot) nextPlot = null
    }
    const next = {
      name: normalizedConfig.projectName,
      visualStyle: normalizedConfig.visualStyle,
      targetMedium: normalizedConfig.targetMedium,
      totalEpisodes: normalizedConfig.totalEpisodes,
      configJson: JSON.stringify(normalizedConfig),
      updatedAt: now
    }
    const previous = {
      name: currentProject.name,
      visualStyle: currentProject.visualStyle,
      targetMedium: currentProject.targetMedium,
      totalEpisodes: currentProject.totalEpisodes,
      configJson: JSON.stringify(currentProject.config),
      updatedAt: currentProject.updatedAt
    }
    const projection: SettingsProjection = {
      projectId: currentProject.id,
      projectPath: currentProject.projectPath,
      previous,
      next
    }
    const writes = [
      { path: configPath, expected: currentConfig, content: nextConfig },
      ...(nextPlot === null
        ? []
        : [{ path: plotPath, expected: currentPlot, content: nextPlot }])
    ]
    const operationId = randomUUID()
    const store = new ProductionCommitStore(
      currentProject.projectPath,
      currentProject.config
    )
    const intent = await store.intent(
      operationId,
      'project-settings',
      commitHash(JSON.stringify({ nextConfig, nextPlot })),
      [],
      [configPath, ...(nextPlot === null ? [] : [plotPath])],
      'project-settings'
    )
    if (intent.phase === 'intent') {
      const prepared = await store.prepare(intent, writes, projection)
      await store.install(prepared)
    }
    await recoverProjectSettingsCommits(
      currentProject.projectPath,
      currentProject.config,
      lease,
      currentProject.id,
      projectSettingsRecord
    )
    return getRegisteredProject(id)!
  } finally {
    if (ownsLease) releaseExecutionLease(lease)
  }
}

export async function migrateLegacyNovelDirectory(projectPath: string) {
  return await migrateLegacyNovelDirectoryRecord(projectPath)
}

export async function repairProjectIssues(
  params: import('@shared/project-detection').ProjectRepairIssueParams
) {
  return await repairProjectIssuesRecord(params)
}

export function deleteProject(id: string): void {
  deleteProjectRecord(id)
}

export function listProjectEpisodes(projectId: string): Episode[] {
  return listEpisodes(projectId)
}

export async function syncProjectEpisodes(
  projectId: string,
  projectPath: string
): Promise<Episode[]> {
  return await syncEpisodeStatus(projectId, projectPath)
}

export async function syncProjectEpisode(
  projectId: string,
  projectPath: string,
  episodeNum: number
): Promise<Episode | null> {
  return await syncSingleEpisodeStatus(projectId, projectPath, episodeNum)
}

export async function syncRegisteredProjectStatus(
  params: ProjectSyncParams
): Promise<Episode[]> {
  return await syncProjectEpisodes(params.projectId, params.projectPath)
}

export async function syncRegisteredProjectEpisodeStatus(
  params: ProjectEpisodeSyncParams
): Promise<Episode | null> {
  return await syncProjectEpisode(
    params.projectId,
    params.projectPath,
    params.episodeNum
  )
}
