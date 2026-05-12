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
    const project = await getProject(id)
    set({ currentProject: project })
    if (project) {
      const episodes = await listProjectEpisodes(project.id)
      set({ episodes })
    }
  },

  loadEpisodes: async (projectId) => {
    const episodes = await listProjectEpisodes(projectId)
    set({ episodes })
  },

  refreshProject: async () => {
    const { currentProject } = get()
    if (!currentProject) return
    const episodes = await listProjectEpisodes(currentProject.id)
    set({ episodes })
  },

  syncEpisodeStatus: async () => {
    const { currentProject } = get()
    if (!currentProject) return
    clearCachedTextFiles()
    const episodes = await syncProjectStatus(
      currentProject.id,
      currentProject.projectPath
    )
    set({ episodes })
  },

  syncSingleEpisodeStatus: async (episodeNum) => {
    const { currentProject } = get()
    if (!currentProject || episodeNum <= 0) return
    clearCachedTextFiles()
    const episode = await syncSingleEpisodeSnapshot({
      projectId: currentProject.id,
      projectPath: currentProject.projectPath,
      episodeNum
    })
    if (!episode) return

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
    const project = await updateProjectRecord(id, data)
    set((state) => ({
      currentProject:
        state.currentProject?.id === id ? project : state.currentProject,
      projects: state.projects.map((item) => (item.id === id ? project : item))
    }))
    if (get().currentProject?.id === id) {
      const episodes = await listProjectEpisodes(id)
      set({ episodes })
    }
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
      set({ currentProject: null, episodes: [] })
    }
    await get().loadProjects()
  },

  setCurrentProject: (project) => set({ currentProject: project })
}))
