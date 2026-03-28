import { ipcMain, dialog, app } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { existsSync, readdirSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import * as queries from '../db/queries'
import { createProvider } from '../llm/provider-factory'
import { registerPipelineHandlers } from './pipeline-handlers'
import { registerAssetHandlers } from './asset-handlers'
import { registerArtifactHandlers } from './artifact-handlers'
import { registerExportHandlers } from './export-handlers'
import { registerAdaptHandlers } from './adapt-handlers'
import { registerProjectFileHandlers } from './project-file-handlers'
import { registerDirectorHandlers } from './director-handlers'
import { registerArtHandlers } from './art-handlers'
import { registerStoryboardHandlers } from './storyboard-handlers'
import { readProjectStateFile } from '../engine/project-state'
import type { LLMConfig, LLMProviderType } from '@shared/types'
import { assertPathAccess, assertProjectPathAccess, grantPathAccess } from './path-access'
import { ensureProjectDataCompatibility } from '../project/project-data-compat'
import { exportAppDeliveryReport, getAppDeliveryStatus } from '../app/delivery-status'
import { calculateProjectProgress, runProjectCommand } from '../project/project-progress'

export function registerAllHandlers(): void {
  // 注册流水线 handlers
  registerPipelineHandlers()
  // 注册资产 handlers
  registerAssetHandlers()
  // 注册产物治理 handlers
  registerArtifactHandlers()
  // 注册导出 handlers
  registerExportHandlers()
  // 注册项目内容 handlers
  registerProjectFileHandlers()
  // 注册导演阶段 handlers
  registerDirectorHandlers()
  // 注册服化道阶段 handlers
  registerArtHandlers()
  // 注册分镜阶段 handlers
  registerStoryboardHandlers()
  // 注册编剧管线 handlers（使用与管线二一致的 builtin-skills 路径）
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  const skillsDir = isDev
    ? join(process.cwd(), 'resources', 'builtin-skills')
    : join(process.resourcesPath, 'builtin-skills')
  registerAdaptHandlers(skillsDir)

  // ==================== 项目 ====================

  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    return queries.listProjects()
  })

  ipcMain.handle(IPC.PROJECT_GET, async (_event, id: string) => {
    return queries.getProject(id)
  })

  ipcMain.handle(IPC.PROJECT_CREATE, async (_event, data) => {
    const project = queries.createProject({
      ...data,
      config: {
        workingDirectory: data.projectPath,
        ...(data.config || {}),
        ...(data.novelTitle ? {
          originalContent: {
            ...((data.config || {}).originalContent || {}),
            title: data.novelTitle,
            genre: data.novelGenre,
            contentFormat: data.sourceType === 'novel' ? 'chapters' : undefined
          }
        } : {})
      }
    })
    grantPathAccess(project.projectPath)
    await ensureProjectDataCompatibility(project.projectPath)
    return project
  })

  ipcMain.handle(IPC.PROJECT_OPEN, async (_event, projectPath: string) => {
    const safeProjectPath = grantPathAccess(projectPath)
    const project = queries.createProject({
      name: '已打开项目',
      visualStyle: '',
      targetMedium: '',
      projectPath: safeProjectPath,
      totalEpisodes: 0,
      config: { workingDirectory: safeProjectPath }
    })
    await ensureProjectDataCompatibility(project.projectPath)
    return project
  })

  ipcMain.handle(IPC.PROJECT_DELETE, async (_event, id: string) => {
    queries.deleteProject(id)
    return { success: true }
  })

  ipcMain.handle(IPC.PROJECT_UPDATE_PHASE, async (_event, id: string, phase: string) => {
    queries.updateProjectPhase(id, phase as import('@shared/types').ProjectPhase)
    return queries.getProject(id)
  })

  // ==================== LLM 配置 ====================

  ipcMain.handle(IPC.LLM_LIST_CONFIGS, async () => {
    return queries.listLLMConfigs()
  })

  ipcMain.handle(IPC.LLM_ADD_CONFIG, async (_event, data: Omit<LLMConfig, 'id'>) => {
    return queries.addLLMConfig(data)
  })

  ipcMain.handle(IPC.LLM_DELETE_CONFIG, async (_event, id: string) => {
    queries.deleteLLMConfig(id)
    return { success: true }
  })

  ipcMain.handle(IPC.LLM_UPDATE_CONFIG, async (_event, id: string, data: Partial<LLMConfig>) => {
    queries.updateLLMConfig(id, data)
    return { success: true }
  })

  ipcMain.handle(IPC.LLM_TEST_CONNECTION, async (_event, config: LLMConfig) => {
    try {
      const provider = createProvider(config)
      return await provider.testConnection()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, message: msg }
    }
  })

  // ==================== 文件操作 ====================

  ipcMain.handle(IPC.FILE_READ, async (_event, filePath: string) => {
    const safePath = assertPathAccess(filePath)
    if (!existsSync(safePath)) return null
    return readFile(safePath, 'utf-8')
  })

  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    const safePath = assertPathAccess(filePath)
    await mkdir(dirname(safePath), { recursive: true })
    await writeFile(safePath, content, 'utf-8')
    return { success: true }
  })

  ipcMain.handle(IPC.FILE_READDIR, async (_event, dirPath: string) => {
    const safePath = assertPathAccess(dirPath)
    if (!existsSync(safePath)) return []
    return readdirSync(safePath) as string[]
  })

  ipcMain.handle(IPC.FILE_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return grantPathAccess(result.filePaths[0])
  })

  ipcMain.handle(IPC.FILE_SELECT_FILE, async (_event, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return grantPathAccess(result.filePaths[0])
  })

  // ==================== 集数 ====================

  ipcMain.handle(IPC.PROJECT_GET_STATUS, async (_event, projectId: string) => {
    return queries.listEpisodes(projectId)
  })

  ipcMain.handle(IPC.PROJECT_SYNC_STATUS, async (_event, projectId: string, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return queries.syncEpisodeStatus(projectId, safeProjectPath)
  })

  ipcMain.handle(IPC.PROJECT_GET_PROGRESS, async (_event, projectPath: string, totalEpisodesHint = 0) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return calculateProjectProgress(safeProjectPath, totalEpisodesHint)
  })

  ipcMain.handle(IPC.PROJECT_RUN_COMMAND, async (_event, params: {
    command: string
    projectPath: string
    totalEpisodesHint?: number
  }) => {
    const safeProjectPath = assertProjectPathAccess(params.projectPath)
    return runProjectCommand({
      command: params.command,
      projectPath: safeProjectPath,
      totalEpisodesHint: params.totalEpisodesHint
    })
  })

  ipcMain.handle(IPC.PROJECT_GET_PIPELINE_STATE, async (_event, projectPath: string) => {
    const safeProjectPath = assertProjectPathAccess(projectPath)
    return readProjectStateFile(safeProjectPath)
  })

  ipcMain.handle(IPC.LLM_SET_DEFAULT, async (_event, id: string) => {
    queries.setDefaultLLMConfig(id)
    return { success: true }
  })

  ipcMain.handle(IPC.LLM_LIST_MODELS, async (_event, baseUrl: string, apiKey: string, provider?: LLMProviderType) => {
    try {
      if (provider && provider !== 'openai' && provider !== 'openai-compatible') {
        return { success: false, models: [], message: `${provider} 暂不支持自动获取模型列表，请手动填写模型名` }
      }
      // 确保 baseUrl 以 /v1 结尾
      let url = baseUrl.replace(/\/+$/, '')
      if (!url.endsWith('/v1')) url += '/v1'
      
      const response = await fetch(`${url}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      if (!response.ok) {
        return { success: false, models: [], message: `HTTP ${response.status}: ${response.statusText}` }
      }
      const data = await response.json() as { data?: Array<{ id: string; display_name?: string; owned_by?: string }> }
      const models = (data.data || []).map(m => ({
        id: m.id,
        name: m.display_name || m.id,
        owner: m.owned_by || ''
      }))
      return { success: true, models, message: `获取到 ${models.length} 个模型` }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, models: [], message: `获取失败: ${msg}` }
    }
  })

  // ==================== 应用 ====================

  ipcMain.handle(IPC.APP_GET_VERSION, async () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC.APP_GET_DELIVERY_STATUS, async () => {
    return getAppDeliveryStatus()
  })

  ipcMain.handle(IPC.APP_EXPORT_DELIVERY_REPORT, async () => {
    return exportAppDeliveryReport()
  })
}
