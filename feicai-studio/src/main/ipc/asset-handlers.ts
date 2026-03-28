// ============================================================
// Asset IPC Handlers — 资产管理 IPC
// ============================================================

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { AssetManager } from '../asset/asset-manager'
import { assertPathAccess, assertProjectPathAccess } from './path-access'

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
    const mgr = getManager(assertProjectPathAccess(projectPath))
    return mgr.loadCharacters()
  })

  ipcMain.handle(IPC.ASSET_LIST_SCENES, async (_event, projectPath: string) => {
    if (!projectPath) return []
    const mgr = getManager(assertProjectPathAccess(projectPath))
    return mgr.loadScenes()
  })

  ipcMain.handle(IPC.ASSET_LOAD_PROMPTS, async (_event, projectPath: string, episodeNum: number) => {
    const mgr = getManager(assertProjectPathAccess(projectPath))
    return mgr.loadPrompts(episodeNum)
  })

  ipcMain.handle(IPC.ASSET_PROMPT_STATS, async (_event, projectPath: string, episodeNum: number) => {
    const mgr = getManager(assertProjectPathAccess(projectPath))
    return mgr.getPromptStats(episodeNum)
  })

  ipcMain.handle(IPC.ASSET_UPLOAD_IMAGE, async (_event, params: {
    projectPath: string
    assetType: 'character' | 'scene'
    assetName: string
    sourcePath: string
  }) => {
    const mgr = getManager(assertProjectPathAccess(params.projectPath))
    return mgr.uploadReferenceImage(
      params.assetType,
      params.assetName,
      assertPathAccess(params.sourcePath)
    )
  })

  ipcMain.handle(IPC.ASSET_LIST_IMAGES, async (_event, projectPath: string, assetType: string) => {
    const mgr = getManager(assertProjectPathAccess(projectPath))
    return mgr.listReferenceImages(assetType as 'character' | 'scene')
  })

  ipcMain.handle(IPC.ASSET_UPDATE_PROMPT, async (_event, params: {
    projectPath: string
    assetType: 'character' | 'scene'
    assetName: string
    newPromptText: string
  }) => {
    const mgr = getManager(assertProjectPathAccess(params.projectPath))
    return mgr.updateAssetPrompt(params.assetType, params.assetName, params.newPromptText)
  })
}
