import { IPC } from '@shared/ipc-channels'
import { AssetManager, assertAssetType } from '../asset/asset-manager'
import {
  assertEpisodeNumber,
  assertNonEmptyString,
  assertRegisteredProjectRoot,
  isSameProjectRoot
} from '../security/access-control'
import { assertAllowedKeys, assertRecord } from '../security/input-validation'
import { registerSafeIpcHandler as handle } from '../security/safe-ipc'
import { listRegisteredProjects } from '../services/project-service'

function getManager(projectPath: unknown): AssetManager {
  assertNonEmptyString(projectPath, '项目目录')
  const root = assertRegisteredProjectRoot(projectPath)
  const project = listRegisteredProjects().find((item) =>
    isSameProjectRoot(item.projectPath, root)
  )
  if (!project) throw new Error('项目未注册')
  return new AssetManager(root, project.config)
}

export function registerAssetHandlers(): void {
  handle(IPC.ASSET_LIST_CHARACTERS, async (_event, path: unknown) =>
    getManager(path).loadCharacters()
  )
  handle(IPC.ASSET_LIST_SCENES, async (_event, path: unknown) =>
    getManager(path).loadScenes()
  )
  handle(
    'asset:load-prompts',
    async (_event, path: unknown, episode: unknown) => {
      assertEpisodeNumber(episode)
      return getManager(path).loadPrompts(episode)
    }
  )
  handle(
    'asset:prompt-stats',
    async (_event, path: unknown, episode: unknown) => {
      assertEpisodeNumber(episode)
      return getManager(path).getPromptStats(episode)
    }
  )
  handle('asset:upload-image', async (_event, params: unknown) => {
    assertRecord(params)
    assertAllowedKeys(params, [
      'projectPath',
      'assetType',
      'assetName',
      'sourcePath'
    ])
    assertAssetType(params.assetType)
    assertNonEmptyString(params.assetName, '素材名')
    assertNonEmptyString(params.sourcePath, '参考图路径')
    return getManager(params.projectPath).uploadReferenceImage(
      params.assetType,
      params.assetName,
      params.sourcePath
    )
  })
  handle('asset:list-images', async (_event, path: unknown, type: unknown) => {
    assertAssetType(type)
    return getManager(path).listReferenceImages(type)
  })
  handle(IPC.ASSET_UPDATE_PROMPT, async (_event, params: unknown) => {
    assertRecord(params)
    assertAllowedKeys(params, [
      'projectPath',
      'assetType',
      'assetName',
      'newPromptText'
    ])
    assertAssetType(params.assetType)
    assertNonEmptyString(params.assetName, '素材名')
    if (typeof params.newPromptText !== 'string')
      throw new Error('提示词必须为字符串')
    return getManager(params.projectPath).updateAssetPrompt(
      params.assetType,
      params.assetName,
      params.newPromptText
    )
  })
}
