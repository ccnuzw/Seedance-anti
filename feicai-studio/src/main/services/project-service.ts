import {
  createProject as createProjectRecord,
  deleteProject as deleteProjectRecord,
  getProject,
  listEpisodes,
  listProjects,
  migrateLegacyNovelDirectory as migrateLegacyNovelDirectoryRecord,
  repairProjectIssues as repairProjectIssuesRecord,
  syncEpisodeStatus,
  syncSingleEpisodeStatus,
  updateProject as updateProjectRecord
} from '../db/queries'
import type { Episode, Project } from '@shared/types'
import type {
  PlotBreakdownSummary,
  SourceChapterItem
} from '@shared/ipc-contracts'
import { listSourceChapters } from '../project/novel-importer'
import { summarizeProjectPlotBreakdown } from '../project/plot-breakdown-store'

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
    config: project.config
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
