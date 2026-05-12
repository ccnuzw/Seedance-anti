import type { DetectedProjectInfo } from '@shared/project-detection'
import type {
  CreateProjectInput,
  PlotBreakdownSummary,
  SourceChapterItem,
  SyncSingleEpisodeParams,
  UpdateProjectInput
} from '@shared/ipc-contracts'
import type { Episode, Project } from '@shared/types'
import type { ServiceProjectPipelineState } from './service-contracts'

export async function listProjects(): Promise<Project[]> {
  return await window.feicaiAPI.listProjects()
}

export async function getProject(id: string): Promise<Project | null> {
  return await window.feicaiAPI.getProject(id)
}

export async function detectProjectDirectory(
  path: string
): Promise<DetectedProjectInfo> {
  return await window.feicaiAPI.detectProjectDirectory(path)
}

export async function inspectProjectDirectory(
  path: string
): Promise<DetectedProjectInfo> {
  return await window.feicaiAPI.inspectProjectDirectory(path)
}

export async function createProject(
  data: CreateProjectInput
): Promise<Project> {
  return await window.feicaiAPI.createProject(data)
}

export async function updateProject(
  id: string,
  data: UpdateProjectInput
): Promise<Project> {
  return await window.feicaiAPI.updateProject(id, data)
}

export async function deleteProject(id: string): Promise<void> {
  await window.feicaiAPI.deleteProject(id)
}

export async function listProjectEpisodes(
  projectId: string
): Promise<Episode[]> {
  return await window.feicaiAPI.listProjectEpisodes(projectId)
}

export async function syncProjectStatus(
  projectId: string,
  projectPath: string
): Promise<Episode[]> {
  return await window.feicaiAPI.syncProjectStatus(projectId, projectPath)
}

export async function syncSingleEpisodeStatus(
  params: SyncSingleEpisodeParams
): Promise<Episode | null> {
  return await window.feicaiAPI.syncSingleEpisodeStatus(params)
}

export async function getProjectPipelineState(
  projectPath: string
): Promise<ServiceProjectPipelineState> {
  return await window.feicaiAPI.getProjectPipelineState(projectPath)
}

export async function migrateLegacyNovelDirectory(projectPath: string) {
  return await window.feicaiAPI.migrateLegacyNovelDirectory(projectPath)
}

export async function repairProjectIssues(
  params: import('@shared/project-detection').ProjectRepairIssueParams
) {
  return await window.feicaiAPI.repairProjectIssues(params)
}

export async function listSourceChapters(
  projectId: string
): Promise<SourceChapterItem[]> {
  return await window.feicaiAPI.listSourceChapters(projectId)
}

export async function getPlotBreakdownSummary(
  projectId: string
): Promise<PlotBreakdownSummary> {
  return await window.feicaiAPI.getPlotBreakdownSummary(projectId)
}
