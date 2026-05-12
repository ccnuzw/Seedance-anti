import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const assertRegisteredProjectRoot = vi.fn((input: string) => input)
const assertProjectFileReadAllowed = vi.fn((input: string) => input)
const assetManagerConstructor = vi.fn()
const loadCharacters = vi.fn()
const loadScenes = vi.fn()
const loadPrompts = vi.fn()
const getPromptStats = vi.fn()
const uploadReferenceImage = vi.fn()
const listReferenceImages = vi.fn()
const updateAssetPrompt = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../security/access-control', () => ({
  assertProjectFileReadAllowed,
  assertRegisteredProjectRoot
}))

vi.mock('../asset/asset-manager', () => ({
  AssetManager: class MockAssetManager {
    projectPath: string

    constructor(projectPath: string) {
      this.projectPath = projectPath
      assetManagerConstructor(projectPath)
    }

    loadCharacters = loadCharacters
    loadScenes = loadScenes
    loadPrompts = loadPrompts
    getPromptStats = getPromptStats
    uploadReferenceImage = uploadReferenceImage
    listReferenceImages = listReferenceImages
    updateAssetPrompt = updateAssetPrompt

    getProjectPath() {
      return this.projectPath
    }
  }
}))

describe('asset-handlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  async function registerHandlers() {
    vi.resetModules()
    const { registerAssetHandlers } = await import('./asset-handlers')
    registerAssetHandlers()
    return await import('@shared/ipc-channels')
  }

  it('空项目路径列角色时直接返回空数组', async () => {
    const { IPC } = await registerHandlers()

    const handler = handlers.get(IPC.ASSET_LIST_CHARACTERS)
    const result = await handler?.({}, '')

    expect(result).toEqual([])
    expect(assetManagerConstructor).not.toHaveBeenCalled()
  })

  it('同一项目路径会复用 AssetManager 实例', async () => {
    const { IPC } = await registerHandlers()
    loadCharacters.mockResolvedValue([{ name: '主角' }])
    loadScenes.mockResolvedValue([{ name: '客厅' }])

    const characterHandler = handlers.get(IPC.ASSET_LIST_CHARACTERS)
    const sceneHandler = handlers.get(IPC.ASSET_LIST_SCENES)
    const characterResult = await characterHandler?.({}, '/tmp/project')
    const sceneResult = await sceneHandler?.({}, '/tmp/project')

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(assetManagerConstructor).toHaveBeenCalledTimes(1)
    expect(assetManagerConstructor).toHaveBeenCalledWith('/tmp/project')
    expect(characterResult).toEqual([{ name: '主角' }])
    expect(sceneResult).toEqual([{ name: '客厅' }])
  })

  it('上传图片时会先校验源文件读取权限并调用 manager', async () => {
    await registerHandlers()
    uploadReferenceImage.mockResolvedValue({
      success: true,
      path: '/tmp/project/assets/character/hero.png'
    })

    const handler = handlers.get('asset:upload-image')
    const payload = {
      projectPath: '/tmp/project',
      assetType: 'character' as const,
      assetName: 'hero',
      sourcePath: '/tmp/source/hero.png'
    }
    const result = await handler?.({}, payload)

    expect(assertProjectFileReadAllowed).toHaveBeenCalledWith(
      '/tmp/source/hero.png'
    )
    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(uploadReferenceImage).toHaveBeenCalledWith(
      'character',
      'hero',
      '/tmp/source/hero.png'
    )
    expect(result).toEqual({
      success: true,
      path: '/tmp/project/assets/character/hero.png'
    })
  })

  it('切换项目路径时会重新创建 AssetManager', async () => {
    await registerHandlers()
    listReferenceImages.mockResolvedValue([])

    const handler = handlers.get('asset:list-images')
    await handler?.({}, '/tmp/project-a', 'character')
    await handler?.({}, '/tmp/project-b', 'scene')

    expect(assetManagerConstructor).toHaveBeenCalledTimes(2)
    expect(assetManagerConstructor).toHaveBeenNthCalledWith(1, '/tmp/project-a')
    expect(assetManagerConstructor).toHaveBeenNthCalledWith(2, '/tmp/project-b')
    expect(listReferenceImages).toHaveBeenNthCalledWith(1, 'character')
    expect(listReferenceImages).toHaveBeenNthCalledWith(2, 'scene')
  })

  it('更新资产提示词时会调用 manager 更新文本', async () => {
    const { IPC } = await registerHandlers()
    updateAssetPrompt.mockResolvedValue({ success: true })

    const handler = handlers.get(IPC.ASSET_UPDATE_PROMPT)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        assetType: 'scene',
        assetName: 'street',
        newPromptText: '夜景街道，湿润路面'
      }
    )

    expect(updateAssetPrompt).toHaveBeenCalledWith(
      'scene',
      'street',
      '夜景街道，湿润路面'
    )
    expect(result).toEqual({ success: true })
  })
})
