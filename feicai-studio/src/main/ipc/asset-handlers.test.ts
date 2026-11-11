import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Project } from '@shared/types'
import { IPC } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => {
  const frame = { url: 'file:///app/index.html' }
  const sender = {
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: () => frame.url
  }
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    projects: [] as Project[],
    frame,
    sender
  }
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, callback)
  },
  BrowserWindow: {
    fromWebContents: (sender: unknown) =>
      sender === mocks.sender ? { id: 1 } : null
  }
}))
vi.mock('../services/project-service', () => ({
  listRegisteredProjects: () => mocks.projects
}))
import { registerAssetHandlers } from './asset-handlers'
import {
  registerProjectRoot,
  rememberSelectedFile,
  resetAccessControl
} from '../security/access-control'
import { setTrustedIpcRendererUrl } from '../security/safe-ipc'
import { flushPendingWrites } from '../io/atomic-file'

const directories: string[] = []
function temporary(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-asset-ipc-'))
  )
  directories.push(root)
  return root
}
function addProject(root: string): void {
  mocks.projects.push({
    id: 'project',
    name: '测试',
    visualStyle: '写实',
    targetMedium: '短剧',
    totalEpisodes: 1,
    projectPath: root,
    config: {
      projectName: '测试',
      visualStyle: '写实',
      targetMedium: '短剧',
      totalEpisodes: 1,
      createdAt: 'now',
      directories: { assetsDir: 'custom-assets' }
    },
    createdAt: 'now',
    updatedAt: 'now'
  })
  registerProjectRoot(root)
}
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return Promise.resolve().then(() =>
    mocks.handlers.get(channel)!(
      { senderFrame: mocks.frame, sender: mocks.sender },
      ...args
    )
  )
}
beforeEach(() => {
  mocks.handlers.clear()
  mocks.projects.length = 0
  resetAccessControl()
  mocks.frame.url = 'file:///app/index.html'
  setTrustedIpcRendererUrl(mocks.frame.url)
  registerAssetHandlers()
})
afterEach(async () => {
  await flushPendingWrites()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('资产IPC真实边界', () => {
  it('从数据库注册配置而非硬编码assets目录读取和编辑资产', async () => {
    const root = temporary()
    addProject(root)
    mkdirSync(join(root, 'custom-assets'))
    const file = join(root, 'custom-assets/character-prompts.md')
    writeFileSync(file, '## 主角\n\n原提示词')
    const result = await invoke(IPC.ASSET_LIST_CHARACTERS, root)
    expect(result).toEqual([
      expect.objectContaining({ name: '主角', promptText: '原提示词' })
    ])
    expect(
      await invoke(IPC.ASSET_UPDATE_PROMPT, {
        projectPath: root,
        assetType: 'character',
        assetName: '主角',
        newPromptText: '新提示词'
      })
    ).toEqual({ success: true })
    expect(readFileSync(file, 'utf8')).toContain('新提示词')
  })

  it('上传真实二进制仅授权选中源，拒绝无效类型与链接目标', async () => {
    const root = temporary()
    const external = temporary()
    addProject(root)
    const source = join(external, 'source.png')
    const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3])
    writeFileSync(source, bytes)
    const params = {
      projectPath: root,
      assetType: 'scene',
      assetName: 'street',
      sourcePath: source
    }
    await expect(invoke('asset:upload-image', params)).rejects.toThrow('未授权')
    rememberSelectedFile(source)
    const path = await invoke('asset:upload-image', params)
    expect(typeof path).toBe('string')
    expect(readFileSync(String(path))).toEqual(bytes)
    await expect(
      invoke('asset:upload-image', { ...params, assetType: '../escape' })
    ).rejects.toThrow('素材类型')
    symlinkSync(
      join(external, 'missing.png'),
      join(root, 'custom-assets/images/scene/link.png')
    )
    await expect(
      invoke('asset:upload-image', { ...params, assetName: 'link' })
    ).rejects.toThrow('符号链接')
  })

  it('拒绝未注册根、非法集数、远端和同URL子frame', async () => {
    const root = temporary()
    await expect(invoke(IPC.ASSET_LIST_CHARACTERS, root)).rejects.toThrow(
      '未授权'
    )
    addProject(root)
    await expect(invoke('asset:load-prompts', root, 0)).rejects.toThrow('集数')
    await expect(
      invoke('asset:list-images', root, '../../outside')
    ).rejects.toThrow('素材类型')
    mocks.frame.url = 'https://evil.example/'
    await expect(invoke(IPC.ASSET_LIST_SCENES, root)).rejects.toThrow('frame')
    mocks.frame.url = 'file:///app/index.html'
    await expect(
      Promise.resolve().then(() =>
        mocks.handlers.get(IPC.ASSET_LIST_SCENES)!(
          { sender: mocks.sender, senderFrame: { url: mocks.frame.url } },
          root
        )
      )
    ).rejects.toThrow('frame')
  })
})
