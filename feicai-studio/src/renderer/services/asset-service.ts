import type {
  ServiceAssetUpdatePromptParams,
  ServiceAssetUpdatePromptResult,
  ServiceCharacterList,
  ServiceSceneList
} from './service-contracts'

export async function listCharacters(
  projectPath: string
): Promise<ServiceCharacterList> {
  return await window.feicaiAPI.listCharacters(projectPath)
}

export async function listScenes(
  projectPath: string
): Promise<ServiceSceneList> {
  return await window.feicaiAPI.listScenes(projectPath)
}

export async function updateAssetPrompt(
  params: ServiceAssetUpdatePromptParams
): Promise<ServiceAssetUpdatePromptResult> {
  return await window.feicaiAPI.updateAssetPrompt(params)
}
