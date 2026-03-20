// ============================================================
// Project Store — 项目状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import { IPC } from '@shared/ipc-channels'
import type { Project, Episode, ProjectSourceType, ProjectPhase } from '@shared/types'

interface ProjectStore {
  projects: Project[]
  currentProject: Project | null
  episodes: Episode[]
  loading: boolean

  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  loadEpisodes: (projectId: string) => Promise<void>
  syncEpisodeStatus: () => Promise<void>
  createProject: (data: {
    name: string
    sourceType?: ProjectSourceType
    phase?: ProjectPhase
    visualStyle: string
    targetMedium: string
    projectPath: string
    totalEpisodes: number
    novelTitle?: string
    novelGenre?: string
    config: Record<string, unknown>
  }) => Promise<Project>
  importProject: () => Promise<string | null>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (project: Project | null) => void
  updatePhase: (phase: ProjectPhase) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  episodes: [],
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    try {
      const projects = await window.feicaiAPI.invoke(IPC.PROJECT_LIST) as Project[]
      set({ projects, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  loadProject: async (id) => {
    try {
      const project = await window.feicaiAPI.invoke(IPC.PROJECT_GET, id) as Project | null
      set({ currentProject: project })
      if (project) {
        // 同步文件系统状态并加载 episodes
        const episodes = await window.feicaiAPI.invoke(IPC.PROJECT_SYNC_STATUS, project.id, project.projectPath) as Episode[]
        set({ episodes })
      }
    } catch {
      set({ currentProject: null, episodes: [] })
    }
  },

  loadEpisodes: async (projectId) => {
    const episodes = await window.feicaiAPI.invoke(IPC.PROJECT_GET_STATUS, projectId) as Episode[]
    set({ episodes })
  },

  syncEpisodeStatus: async () => {
    const { currentProject } = get()
    if (!currentProject) return
    const episodes = await window.feicaiAPI.invoke(
      IPC.PROJECT_SYNC_STATUS, currentProject.id, currentProject.projectPath
    ) as Episode[]
    set({ episodes })
  },

  createProject: async (data) => {
    const project = await window.feicaiAPI.invoke(IPC.PROJECT_CREATE, data) as Project
    await get().loadProjects()
    return project
  },

  importProject: async () => {
    const dirPath = await window.feicaiAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    return dirPath
  },

  deleteProject: async (id) => {
    await window.feicaiAPI.invoke(IPC.PROJECT_DELETE, id)
    const { currentProject } = get()
    if (currentProject?.id === id) {
      set({ currentProject: null, episodes: [] })
    }
    await get().loadProjects()
  },

  setCurrentProject: (project) => set({ currentProject: project }),

  updatePhase: async (phase) => {
    const { currentProject } = get()
    if (!currentProject) return
    const updated = await window.feicaiAPI.invoke(
      IPC.PROJECT_UPDATE_PHASE, currentProject.id, phase
    ) as Project
    set({ currentProject: updated })
    await get().loadProjects()
  }
}))
