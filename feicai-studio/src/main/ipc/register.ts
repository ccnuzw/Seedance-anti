import { ipcMain, dialog, app } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { existsSync, readdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import * as queries from '../db/queries'
import { createProvider } from '../llm/provider-factory'
import { registerPipelineHandlers } from './pipeline-handlers'
import { registerAssetHandlers } from './asset-handlers'
import { registerExportHandlers } from './export-handlers'
import { registerAdaptHandlers } from './adapt-handlers'
import type { LLMConfig } from '@shared/types'

export function registerAllHandlers(): void {
  // 注册流水线 handlers
  registerPipelineHandlers()
  // 注册资产 handlers
  registerAssetHandlers()
  // 注册导出 handlers
  registerExportHandlers()
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
    return queries.createProject(data)
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
    if (!existsSync(filePath)) return null
    return readFile(filePath, 'utf-8')
  })

  ipcMain.handle(IPC.FILE_WRITE, async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
    return { success: true }
  })

  ipcMain.handle(IPC.FILE_READDIR, async (_event, dirPath: string) => {
    if (!existsSync(dirPath)) return []
    return readdirSync(dirPath) as string[]
  })

  ipcMain.handle(IPC.FILE_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle(IPC.FILE_SELECT_FILE, async (_event, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // ==================== 集数 ====================

  ipcMain.handle(IPC.PROJECT_GET_STATUS, async (_event, projectId: string) => {
    return queries.listEpisodes(projectId)
  })

  ipcMain.handle(IPC.PROJECT_SYNC_STATUS, async (_event, projectId: string, projectPath: string) => {
    return queries.syncEpisodeStatus(projectId, projectPath)
  })

  ipcMain.handle(IPC.PROJECT_GET_PIPELINE_STATE, async (_event, projectPath: string) => {
    try {
      const statePath = join(projectPath, 'outputs', 'pipeline-state.json')
      const content = await readFile(statePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.LLM_SET_DEFAULT, async (_event, id: string) => {
    queries.setDefaultLLMConfig(id)
    return { success: true }
  })

  ipcMain.handle(IPC.LLM_LIST_MODELS, async (_event, baseUrl: string, apiKey: string) => {
    try {
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
}
