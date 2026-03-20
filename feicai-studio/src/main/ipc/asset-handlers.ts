// ============================================================
// Asset IPC Handlers — 资产管理 IPC
// ============================================================

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { AssetManager } from '../asset/asset-manager'

// 缓存 AssetManager 实例
let assetManager: AssetManager | null = null

function getManager(projectPath: string): AssetManager {
  if (!assetManager || (assetManager as any).projectPath !== projectPath) {
    assetManager = new AssetManager(projectPath)
  }
  return assetManager
}

export function registerAssetHandlers(): void {
  ipcMain.handle(IPC.ASSET_LIST_CHARACTERS, async (_event, projectPath: string) => {
    if (!projectPath) return []
    const mgr = getManager(projectPath)
    return mgr.loadCharacters()
  })

  ipcMain.handle(IPC.ASSET_LIST_SCENES, async (_event, projectPath: string) => {
    if (!projectPath) return []
    const mgr = getManager(projectPath)
    return mgr.loadScenes()
  })

  ipcMain.handle('asset:load-prompts', async (_event, projectPath: string, episodeNum: number) => {
    const mgr = getManager(projectPath)
    return mgr.loadPrompts(episodeNum)
  })

  ipcMain.handle('asset:prompt-stats', async (_event, projectPath: string, episodeNum: number) => {
    const mgr = getManager(projectPath)
    return mgr.getPromptStats(episodeNum)
  })

  ipcMain.handle('asset:upload-image', async (_event, params: {
    projectPath: string
    assetType: 'character' | 'scene'
    assetName: string
    sourcePath: string
  }) => {
    const mgr = getManager(params.projectPath)
    return mgr.uploadReferenceImage(params.assetType, params.assetName, params.sourcePath)
  })

  ipcMain.handle('asset:list-images', async (_event, projectPath: string, assetType: string) => {
    const mgr = getManager(projectPath)
    return mgr.listReferenceImages(assetType as 'character' | 'scene')
  })

  ipcMain.handle(IPC.ASSET_UPDATE_PROMPT, async (_event, params: {
    projectPath: string
    assetType: 'character' | 'scene'
    assetName: string
    newPromptText: string
  }) => {
    const mgr = getManager(params.projectPath)
    return mgr.updateAssetPrompt(params.assetType, params.assetName, params.newPromptText)
  })
}
