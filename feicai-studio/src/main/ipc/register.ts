import { ipcMain, dialog } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { registerPipelineHandlers } from './pipeline-handlers'
import { registerAssetHandlers } from './asset-handlers'
import { registerExportHandlers } from './export-handlers'
import type { LLMConfig } from '@shared/types'
import { detectProjectDirectory } from '../project/project-detector'
import {
  createProject,
  deleteProject,
  getRegisteredProject,
  getRegisteredProjectPlotBreakdownSummary,
  listRegisteredProjectSourceChapters,
  listProjectEpisodes,
  listRegisteredProjects,
  migrateLegacyNovelDirectory,
  repairProjectIssues,
  syncRegisteredProjectEpisodeStatus,
  syncRegisteredProjectStatus,
  updateProject
} from '../services/project-service'
import {
  addLLMConfig,
  deleteLLMConfig,
  listLLMConfigs,
  listLLMModels,
  setDefaultLLM,
  testLLMConnection,
  updateLLMConfig
} from '../services/llm-service'
import { getProjectPipelineState } from '../services/project-state-service'
import {
  assertProjectFileReadAllowed,
  assertProjectFileWriteAllowed,
  assertRegisteredProjectRoot,
  assertSelectedFileAllowed,
  assertTrustedProjectSelection,
  registerProjectRoot,
  registerProjectRoots,
  rememberSelectedDirectory,
  rememberSelectedFile
} from '../security/access-control'

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? (error as { code?: string }).code : undefined
  const errno =
    'errno' in error ? (error as { errno?: number }).errno : undefined
  const message =
    'message' in error
      ? String((error as { message?: string }).message || '')
      : ''
  return code === 'ENOENT' || errno === -2 || message.includes('ENOENT')
}

export function registerAllHandlers(): void {
  // 注册流水线 handlers
  registerPipelineHandlers()
  // 注册资产 handlers
  registerAssetHandlers()
  // 注册导出 handlers
  registerExportHandlers()

  // ==================== 项目 ====================

  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    const projects = listRegisteredProjects()
    registerProjectRoots(projects.map((project) => project.projectPath))
    return projects
  })

  ipcMain.handle(IPC.PROJECT_GET, async (_event, id: string) => {
    const project = getRegisteredProject(id)
    if (project?.projectPath) {
      registerProjectRoot(project.projectPath)
    }
    return project
  })

  ipcMain.handle(IPC.PROJECT_DETECT_DIR, async (_event, dirPath: string) => {
    const trustedPath = assertTrustedProjectSelection(dirPath)
    return detectProjectDirectory(trustedPath)
  })

  ipcMain.handle(IPC.PROJECT_INSPECT, async (_event, projectPath: string) => {
    const trustedPath = assertRegisteredProjectRoot(projectPath)
    return detectProjectDirectory(trustedPath)
  })

  ipcMain.handle(
    IPC.PROJECT_MIGRATE_LEGACY_NOVEL,
    async (_event, projectPath: string) => {
      const trustedPath = assertRegisteredProjectRoot(projectPath)
      return await migrateLegacyNovelDirectory(trustedPath)
    }
  )

  ipcMain.handle(IPC.PROJECT_REPAIR, async (_event, params) => {
    const trustedPath =
      params.trustMode === 'registered'
        ? assertRegisteredProjectRoot(params.projectPath)
        : assertTrustedProjectSelection(params.projectPath)
    return await repairProjectIssues({
      ...params,
      projectPath: trustedPath
    })
  })

  ipcMain.handle(IPC.PROJECT_LIST_SOURCE_CHAPTERS, async (_event, id: string) => {
    const project = getRegisteredProject(id)
    if (!project) return []
    assertRegisteredProjectRoot(project.projectPath)
    return listRegisteredProjectSourceChapters(id)
  })

  ipcMain.handle(
    IPC.PROJECT_GET_PLOT_BREAKDOWN_SUMMARY,
    async (_event, id: string) => {
      const project = getRegisteredProject(id)
      if (!project) {
        return {
          path: '',
          exists: false,
          totalEntries: 0,
          usedEntries: 0,
          unusedEntries: 0,
          totalBatches: 0
        }
      }
      assertRegisteredProjectRoot(project.projectPath)
      return getRegisteredProjectPlotBreakdownSummary(id)
    }
  )

  ipcMain.handle(IPC.PROJECT_CREATE, async (_event, data) => {
    const trustedPath = assertTrustedProjectSelection(data.projectPath)
    const sourceNovelFilePath = data.sourceNovelFilePath
      ? assertSelectedFileAllowed(data.sourceNovelFilePath)
      : undefined
    const project = await createProject({
      ...data,
      projectPath: trustedPath,
      sourceNovelFilePath
    })
    registerProjectRoot(project.projectPath)
    return project
  })

  ipcMain.handle(IPC.PROJECT_UPDATE, async (_event, id: string, data) => {
    const currentProject = getRegisteredProject(id)
    if (!currentProject) {
      throw new Error(`项目不存在: ${id}`)
    }
    assertRegisteredProjectRoot(currentProject.projectPath)
    const project = await updateProject(id, data)
    registerProjectRoot(project.projectPath)
    return project
  })

  ipcMain.handle(IPC.PROJECT_DELETE, async (_event, id: string) => {
    deleteProject(id)
    return { success: true }
  })

  // ==================== LLM 配置 ====================

  ipcMain.handle(IPC.LLM_LIST_CONFIGS, async () => {
    return listLLMConfigs()
  })

  ipcMain.handle(
    IPC.LLM_ADD_CONFIG,
    async (_event, data: Omit<LLMConfig, 'id'>) => {
      return addLLMConfig(data)
    }
  )

  ipcMain.handle(IPC.LLM_DELETE_CONFIG, async (_event, id: string) => {
    deleteLLMConfig(id)
    return { success: true }
  })

  ipcMain.handle(
    IPC.LLM_UPDATE_CONFIG,
    async (_event, id: string, data: Partial<LLMConfig>) => {
      updateLLMConfig(id, data)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LLM_TEST_CONNECTION, async (_event, config: LLMConfig) => {
    return await testLLMConnection(config)
  })

  // ==================== 文件操作 ====================

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) => {
    const trustedPath = assertProjectFileReadAllowed(filePath)
    if (!existsSync(trustedPath)) {
      return null
    }
    try {
      return await readFile(trustedPath, 'utf-8')
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null
      }
      throw error
    }
  })

  ipcMain.handle(
    IPC.FILE_WRITE,
    async (_event, filePath: string, content: string) => {
      const trustedPath = assertProjectFileWriteAllowed(filePath)
      await writeFile(trustedPath, content, 'utf-8')
      return { success: true }
    }
  )

  ipcMain.handle(IPC.FILE_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return rememberSelectedDirectory(result.filePaths[0])
  })

  ipcMain.handle(
    IPC.FILE_SELECT_FILE,
    async (_event, filters?: Electron.FileFilter[]) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: filters || [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return rememberSelectedFile(result.filePaths[0])
    }
  )

  // ==================== 集数 ====================

  ipcMain.handle(IPC.PROJECT_GET_STATUS, async (_event, projectId: string) => {
    return listProjectEpisodes(projectId)
  })

  ipcMain.handle(
    IPC.PROJECT_SYNC_STATUS,
    async (_event, projectId: string, projectPath: string) => {
      const trustedPath = assertRegisteredProjectRoot(projectPath)
      return await syncRegisteredProjectStatus({
        projectId,
        projectPath: trustedPath
      })
    }
  )

  ipcMain.handle(
    IPC.PROJECT_SYNC_EPISODE_STATUS,
    async (
      _event,
      params: {
        projectId: string
        projectPath: string
        episodeNum: number
      }
    ) => {
      const trustedPath = assertRegisteredProjectRoot(params.projectPath)
      return await syncRegisteredProjectEpisodeStatus({
        projectId: params.projectId,
        projectPath: trustedPath,
        episodeNum: params.episodeNum
      })
    }
  )

  ipcMain.handle(
    IPC.PROJECT_GET_PIPELINE_STATE,
    async (_event, projectPath: string) => {
      const trustedPath = assertRegisteredProjectRoot(projectPath)
      return await getProjectPipelineState(trustedPath)
    }
  )

  ipcMain.handle(IPC.LLM_SET_DEFAULT, async (_event, id: string) => {
    setDefaultLLM(id)
    return { success: true }
  })

  ipcMain.handle(
    IPC.LLM_LIST_MODELS,
    async (
      _event,
      payload: {
        baseUrl: string
        apiKey?: string
        configId?: string
      }
    ) => {
      return await listLLMModels(payload)
    }
  )

  // ==================== 应用 ====================

  ipcMain.handle(IPC.APP_GET_VERSION, async () => {
    const { app } = require('electron')
    return app.getVersion()
  })
}
