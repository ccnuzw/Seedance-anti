// ============================================================
// Project Store — 项目状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import { IPC } from '@shared/ipc-channels'
import type { Project, Episode, ProjectSourceType, ProjectPhase } from '@shared/types'
import { platformAPI } from '@renderer/platform/api'

interface ProjectStatusRefreshState {
  syncing: boolean
  source: 'load' | 'status-command' | null
  lastUpdatedAt: number | null
  lastMessage: string | null
  lastSuccess: boolean | null
}

interface ProjectStore {
  projects: Project[]
  currentProject: Project | null
  episodes: Episode[]
  loading: boolean
  statusRefresh: ProjectStatusRefreshState

  loadProjects: () => Promise<boolean>
  loadProject: (id: string) => Promise<boolean>
  loadEpisodes: (projectId: string) => Promise<boolean>
  syncEpisodeStatus: (source?: 'load' | 'status-command') => Promise<boolean>
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
  saveProjectConfig: (projectPath: string, config: Record<string, unknown>) => Promise<Project | null>
}

let _loadProjectsRequestSeq = 0
let _loadProjectRequestSeq = 0
let _loadEpisodesRequestSeq = 0
let _syncEpisodeStatusRequestSeq = 0

function mergeProjectSnapshot(projects: Project[], nextProject: Project): Project[] {
  const existingIndex = projects.findIndex((project) => project.id === nextProject.id)
  if (existingIndex === -1) {
    return [nextProject, ...projects]
  }
  return projects.map((project) => project.id === nextProject.id ? nextProject : project)
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  episodes: [],
  loading: false,
  statusRefresh: {
    syncing: false,
    source: null,
    lastUpdatedAt: null,
    lastMessage: null,
    lastSuccess: null
  },

  loadProjects: async () => {
    const requestSeq = ++_loadProjectsRequestSeq
    set({ loading: true })
    try {
      const projects = await platformAPI.invoke(IPC.PROJECT_LIST) as Project[]
      if (requestSeq !== _loadProjectsRequestSeq) return false
      set((state) => ({
        projects,
        currentProject: state.currentProject
          ? projects.find((project) => project.id === state.currentProject?.id) || state.currentProject
          : null,
        loading: false
      }))
      return true
    } catch {
      if (requestSeq !== _loadProjectsRequestSeq) return false
      set({ loading: false })
      return false
    }
  },

  loadProject: async (id) => {
    const requestSeq = ++_loadProjectRequestSeq
    const previousProject = get().currentProject
    const previousEpisodes = get().episodes
    let project: Project | null = null

    try {
      project = await platformAPI.invoke(IPC.PROJECT_GET, id) as Project | null
    } catch {
      if (requestSeq !== _loadProjectRequestSeq) return false
      if (previousProject?.id !== id) {
        set({ currentProject: null, episodes: [] })
      }
      return false
    }

    if (requestSeq !== _loadProjectRequestSeq) return false

    if (!project) {
      set({ currentProject: null, episodes: [] })
      return false
    }

    const isSameProject = previousProject?.id === project.id
    set((state) => ({
      currentProject: project,
      episodes: isSameProject ? previousEpisodes : [],
      projects: mergeProjectSnapshot(state.projects, project)
    }))

    try {
      const episodes = await platformAPI.invoke(IPC.PROJECT_SYNC_STATUS, project.id, project.projectPath) as Episode[]
      if (requestSeq !== _loadProjectRequestSeq) return false
      if (get().currentProject?.id === project.id) {
        set({
          episodes,
          statusRefresh: {
            syncing: false,
            source: 'load',
            lastUpdatedAt: Date.now(),
            lastMessage: `已载入 ${episodes.length} 集项目状态`,
            lastSuccess: true
          }
        })
      }
    } catch {
      if (requestSeq !== _loadProjectRequestSeq) return false
      if (isSameProject && get().currentProject?.id === project.id) {
        set({
          episodes: previousEpisodes,
          statusRefresh: {
            syncing: false,
            source: 'load',
            lastUpdatedAt: Date.now(),
            lastMessage: '项目状态载入失败，已保留上次结果',
            lastSuccess: false
          }
        })
      }
      return false
    }
    return true
  },

  loadEpisodes: async (projectId) => {
    const requestSeq = ++_loadEpisodesRequestSeq
    const previousEpisodes = get().episodes
    try {
      const episodes = await platformAPI.invoke(IPC.PROJECT_GET_STATUS, projectId) as Episode[]
      if (requestSeq !== _loadEpisodesRequestSeq || get().currentProject?.id !== projectId) return false
      set({ episodes })
      return true
    } catch {
      if (requestSeq !== _loadEpisodesRequestSeq || get().currentProject?.id !== projectId) return false
      set({ episodes: previousEpisodes })
      return false
    }
  },

  syncEpisodeStatus: async (source = 'load') => {
    const { currentProject, episodes: previousEpisodes } = get()
    if (!currentProject) return false
    const requestSeq = ++_syncEpisodeStatusRequestSeq

    set((state) => ({
      statusRefresh: {
        ...state.statusRefresh,
        syncing: true,
        source,
        lastMessage: source === 'status-command' ? '正在刷新项目状态（~status）…' : '正在同步项目状态…'
      }
    }))

    let episodes = previousEpisodes
    let updatedProject: Project | null = currentProject
    let episodesOk = true
    let projectOk = true

    try {
      episodes = await platformAPI.invoke(
        IPC.PROJECT_SYNC_STATUS, currentProject.id, currentProject.projectPath
      ) as Episode[]
    } catch {
      episodes = previousEpisodes
      episodesOk = false
    }

    try {
      const fetchedProject = await platformAPI.invoke(
        IPC.PROJECT_GET,
        currentProject.id
      ) as Project | null
      updatedProject = fetchedProject || currentProject
    } catch {
      updatedProject = currentProject
      projectOk = false
    }

    if (requestSeq !== _syncEpisodeStatusRequestSeq || get().currentProject?.id !== currentProject.id) {
      return false
    }

    const success = episodesOk && projectOk
    const message = success
      ? `~status 已刷新：共 ${episodes.length} 集，${episodes.filter((episode) => episode.status === 'complete').length} 集已完成`
      : '项目状态刷新失败，已保留当前结果'

    set((state) => ({
      episodes,
      currentProject: updatedProject || currentProject,
      projects: updatedProject
        ? state.projects.map((project) => project.id === updatedProject.id ? updatedProject : project)
        : state.projects,
      statusRefresh: {
        syncing: false,
        source,
        lastUpdatedAt: Date.now(),
        lastMessage: message,
        lastSuccess: success
      }
    }))
    return success
  },

  createProject: async (data) => {
    const project = await platformAPI.invoke(IPC.PROJECT_CREATE, data) as Project
    await get().loadProjects()
    return project
  },

  importProject: async () => {
    const dirPath = await platformAPI.invoke(IPC.FILE_SELECT_DIR) as string | null
    return dirPath
  },

  deleteProject: async (id) => {
    await platformAPI.invoke(IPC.PROJECT_DELETE, id)
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
    const updated = await platformAPI.invoke(
      IPC.PROJECT_UPDATE_PHASE, currentProject.id, phase
    ) as Project
    set((state) => ({
      currentProject: updated,
      projects: mergeProjectSnapshot(state.projects, updated)
    }))
    await get().loadProjects()
  },

  saveProjectConfig: async (projectPath, config) => {
    const result = await platformAPI.invoke(
      IPC.PROJECT_SAVE_CONFIG,
      projectPath,
      config
    ) as { success?: boolean; project?: Project | null }

    if (!result.success) {
      throw new Error('项目配置保存失败')
    }

    if (result.project) {
      set((state) => ({
        currentProject: state.currentProject?.id === result.project?.id
          ? result.project
          : state.currentProject,
        projects: mergeProjectSnapshot(state.projects, result.project)
      }))
    }

    return result.project || null
  }
}))
