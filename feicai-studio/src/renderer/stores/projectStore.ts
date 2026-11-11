// ============================================================
// Project Store — 项目状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import {
  createProject as createProjectRecord,
  deleteProject as deleteProjectRecord,
  getProject,
  listProjectEpisodes,
  listProjects,
  syncProjectStatus,
  syncSingleEpisodeStatus as syncSingleEpisodeSnapshot,
  updateProject as updateProjectRecord
} from '@renderer/services/project-service'
import { selectDirectory } from '@renderer/services/file-io'
import { clearCachedTextFiles } from '@renderer/services/file-cache'
import type { Project, Episode, ProjectConfig } from '@shared/types'
import type { UpdateProjectInput } from '@shared/ipc-contracts'

interface CreateProjectInput {
  name: string
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  config: Partial<ProjectConfig>
  sourceNovelFilePath?: string
}

interface ProjectStore {
  projects: Project[]
  currentProject: Project | null
  episodes: Episode[]
  loading: boolean

  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  loadEpisodes: (projectId: string) => Promise<void>
  refreshProject: () => Promise<void>
  syncEpisodeStatus: () => Promise<void>
  syncSingleEpisodeStatus: (episodeNum: number) => Promise<void>
  createProject: (data: CreateProjectInput) => Promise<Project>
  updateProject: (id: string, data: UpdateProjectInput) => Promise<Project>
  importProject: () => Promise<string | null>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (project: Project | null) => void
}

// Invalidate pending project reads when selection changes or a newer load starts.
let projectEpoch = 0

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  episodes: [],
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    const projects = await listProjects()
    set({ projects, loading: false })
  },

  loadProject: async (id) => {
    const epoch = ++projectEpoch
    if (get().currentProject?.id !== id)
      set({ currentProject: null, episodes: [] })
    const project = await getProject(id)
    if (epoch !== projectEpoch) return
    const episodes = project ? await listProjectEpisodes(project.id) : []
    if (epoch === projectEpoch) set({ currentProject: project, episodes })
  },

  loadEpisodes: async (projectId) => {
    const epoch = projectEpoch
    const episodes = await listProjectEpisodes(projectId)
    if (epoch === projectEpoch && get().currentProject?.id === projectId)
      set({ episodes })
  },

  refreshProject: async () => {
    const { currentProject } = get()
    if (currentProject) await get().loadEpisodes(currentProject.id)
  },

  syncEpisodeStatus: async () => {
    const { currentProject } = get()
    if (!currentProject) return
    const epoch = projectEpoch
    clearCachedTextFiles()
    const episodes = await syncProjectStatus(
      currentProject.id,
      currentProject.projectPath
    )
    if (
      epoch === projectEpoch &&
      get().currentProject?.id === currentProject.id
    )
      set({ episodes })
  },

  syncSingleEpisodeStatus: async (episodeNum) => {
    const { currentProject } = get()
    if (!currentProject || episodeNum <= 0) return
    const epoch = projectEpoch
    clearCachedTextFiles()
    const episode = await syncSingleEpisodeSnapshot({
      projectId: currentProject.id,
      projectPath: currentProject.projectPath,
      episodeNum
    })
    if (
      !episode ||
      epoch !== projectEpoch ||
      get().currentProject?.id !== currentProject.id
    )
      return

    set((state) => ({
      episodes: state.episodes.some((item) => item.id === episode.id)
        ? state.episodes.map((item) =>
            item.id === episode.id ? episode : item
          )
        : [...state.episodes, episode].sort(
            (a, b) => a.episodeNumber - b.episodeNumber
          )
    }))
  },

  createProject: async (data) => {
    const project = await createProjectRecord(data)
    await get().loadProjects()
    return project
  },

  updateProject: async (id, data) => {
    const epoch = projectEpoch
    const project = await updateProjectRecord(id, data)
    set((state) => ({
      currentProject:
        epoch === projectEpoch && state.currentProject?.id === id
          ? project
          : state.currentProject,
      projects: state.projects.map((item) => (item.id === id ? project : item))
    }))
    if (epoch === projectEpoch && get().currentProject?.id === id)
      await get().loadEpisodes(id)
    return project
  },

  importProject: async () => {
    const dirPath = await selectDirectory()
    return dirPath
  },

  deleteProject: async (id) => {
    await deleteProjectRecord(id)
    const { currentProject } = get()
    if (currentProject?.id === id) {
      get().setCurrentProject(null)
    }
    await get().loadProjects()
  },

  setCurrentProject: (project) => {
    const changed = get().currentProject?.id !== project?.id
    if (changed) projectEpoch++
    set((state) => ({
      currentProject: project,
      episodes: changed ? [] : state.episodes
    }))
  }
}))
