import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Project } from '@shared/types'
import { IPC } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => {
  const frame = { url: 'file:///app/index.html' }
  const sender = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false
  }
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    frame,
    sender,
    projects: [] as Project[],
    showOpenDialog: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    sync: vi.fn(),
    syncEpisode: vi.fn(),
    llmModels: vi.fn()
  }
})
vi.mock('electron', () => ({
  app: { getVersion: () => 'test-version' },
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, callback)
  },
  BrowserWindow: {
    fromWebContents: (sender: unknown) =>
      sender === mocks.sender ? { id: 1 } : null
  },
  dialog: { showOpenDialog: mocks.showOpenDialog }
}))
vi.mock('./pipeline-handlers', () => ({ registerPipelineHandlers: vi.fn() }))
vi.mock('./asset-handlers', () => ({ registerAssetHandlers: vi.fn() }))
vi.mock('./export-handlers', () => ({ registerExportHandlers: vi.fn() }))
vi.mock('../services/project-service', () => ({
  listRegisteredProjects: () => mocks.projects,
  getRegisteredProject: (id: string) =>
    mocks.projects.find((project) => project.id === id) || null,
  createProject: mocks.createProject,
  updateProject: mocks.updateProject,
  deleteProject: vi.fn(),
  listProjectEpisodes: vi.fn(() => []),
  listRegisteredProjectSourceChapters: vi.fn(() => []),
  getRegisteredProjectPlotBreakdownSummary: vi.fn(),
  migrateLegacyNovelDirectory: vi.fn(),
  repairProjectIssues: vi.fn(),
  syncRegisteredProjectStatus: mocks.sync,
  syncRegisteredProjectEpisodeStatus: mocks.syncEpisode
}))
vi.mock('../services/llm-service', () => ({
  listLLMConfigs: vi.fn(() => []),
  addLLMConfig: vi.fn(),
  deleteLLMConfig: vi.fn(),
  updateLLMConfig: vi.fn(),
  setDefaultLLM: vi.fn(),
  testLLMConnection: vi.fn(),
  listLLMModels: mocks.llmModels
}))
vi.mock('../services/project-state-service', () => ({
  getProjectPipelineState: vi.fn()
}))
vi.mock('../project/project-detector', () => ({
  detectProjectDirectory: vi.fn()
}))

import { registerAllHandlers } from './register'
import { setTrustedIpcRendererUrl } from '../security/safe-ipc'
import {
  registerProjectRoot,
  rememberSelectedDirectory,
  rememberSelectedFile,
  resetAccessControl
} from '../security/access-control'
import { flushPendingWrites } from '../io/atomic-file'

const directories: string[] = []
function temporary(): string {
  const directory = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-ipc-'))
  )
  directories.push(directory)
  return directory
}
function project(root: string, id = 'project-1'): Project {
  return {
    id,
    name: '测试',
    projectPath: root,
    visualStyle: '写实',
    targetMedium: '短剧',
    totalEpisodes: 2,
    config: {
      projectName: '测试',
      visualStyle: '写实',
      targetMedium: '短剧',
      totalEpisodes: 2,
      createdAt: 'now'
    },
    createdAt: 'now',
    updatedAt: 'now'
  }
}
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const callback = mocks.handlers.get(channel)
  if (!callback) throw new Error('handler missing')
  return Promise.resolve().then(() =>
    callback({ senderFrame: mocks.frame, sender: mocks.sender }, ...args)
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  resetAccessControl()
  mocks.handlers.clear()
  mocks.projects.length = 0
  mocks.frame.url = 'file:///app/index.html'
  setTrustedIpcRendererUrl(mocks.frame.url)
  registerAllHandlers()
})
afterEach(async () => {
  await flushPendingWrites()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('IPC真实文件能力边界', () => {
  it('普通新文件可原子创建和读取，更新保留bak，读取缺失返回null', async () => {
    const root = temporary()
    mocks.projects.push(project(root))
    await invoke(IPC.PROJECT_LIST)
    const path = join(root, 'nested', 'draft.md')
    expect(await invoke(IPC.FILE_WRITE, path, 'first')).toEqual({
      success: true
    })
    expect(await invoke(IPC.FILE_READ, path)).toBe('first')
    expect(await invoke(IPC.FILE_WRITE, path, 'second', 'first')).toEqual({
      success: true
    })
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('first')
    expect(await invoke(IPC.FILE_READ, join(root, 'missing.md'))).toBeNull()
  })

  it('草稿冲突保持磁盘内容，错误输入不改变文件', async () => {
    const root = temporary()
    registerProjectRoot(root)
    const path = join(root, 'draft.md')
    writeFileSync(path, 'external')
    expect(await invoke(IPC.FILE_WRITE, path, 'mine', 'old')).toEqual({
      success: false,
      error: 'FILE_CONFLICT'
    })
    await expect(invoke(IPC.FILE_WRITE, path, { text: 'bad' })).rejects.toThrow(
      '字符串'
    )
    expect(readFileSync(path, 'utf8')).toBe('external')
  })

  it('有效/悬空链接及父链接拒绝读写且不触碰外部文件', async () => {
    const root = temporary()
    const outside = temporary()
    registerProjectRoot(root)
    const secret = join(outside, 'secret.md')
    writeFileSync(secret, 'secret')
    symlinkSync(secret, join(root, 'valid.md'))
    symlinkSync(join(outside, 'new.md'), join(root, 'dangling.md'))
    symlinkSync(outside, join(root, 'parent'))
    for (const path of [
      join(root, 'valid.md'),
      join(root, 'dangling.md'),
      join(root, 'parent', 'new.md')
    ]) {
      await expect(invoke(IPC.FILE_READ, path)).rejects.toThrow('符号链接')
      await expect(invoke(IPC.FILE_WRITE, path, 'escape')).rejects.toThrow(
        '符号链接'
      )
    }
    expect(readFileSync(secret, 'utf8')).toBe('secret')
    expect(existsSync(join(outside, 'new.md'))).toBe(false)
  })

  it('只选目录不授予任意读取，选定文件不会授权兄弟文件', async () => {
    const root = temporary()
    const selected = join(root, 'selected.md')
    writeFileSync(selected, 'selected')
    writeFileSync(join(root, 'private.md'), 'private')
    rememberSelectedDirectory(root)
    await expect(invoke(IPC.FILE_READ, selected)).rejects.toThrow('未授权读取')
    rememberSelectedFile(selected)
    expect(await invoke(IPC.FILE_READ, selected)).toBe('selected')
    await expect(
      invoke(IPC.FILE_READ, join(root, 'private.md'))
    ).rejects.toThrow('未授权读取')
  })

  it('所有注册入口拒绝远端页面及同URL子frame', async () => {
    mocks.frame.url = 'https://evil.example/'
    await expect(invoke(IPC.PROJECT_LIST)).rejects.toThrow('frame')
    mocks.frame.url = 'file:///app/index.html'
    const callback = mocks.handlers.get(IPC.FILE_READ)!
    await expect(
      Promise.resolve().then(() =>
        callback(
          { sender: mocks.sender, senderFrame: { url: mocks.frame.url } },
          '/tmp/anything'
        )
      )
    ).rejects.toThrow('frame')
  })
})

describe('项目身份和运行时输入', () => {
  it('同步不能混用另一个已注册项目目录，集数也必须合法', async () => {
    const first = temporary()
    const second = temporary()
    mocks.projects.push(project(first), project(second, 'project-2'))
    await invoke(IPC.PROJECT_LIST)
    await expect(
      invoke(IPC.PROJECT_SYNC_STATUS, 'project-1', second)
    ).rejects.toThrow('不一致')
    await expect(
      invoke(IPC.PROJECT_SYNC_EPISODE_STATUS, {
        projectId: 'project-1',
        projectPath: first,
        episodeNum: 0
      })
    ).rejects.toThrow('集数')
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.syncEpisode).not.toHaveBeenCalled()
  })

  it('更新拒绝id/path注入，配置目录链接和穿越不能写入', async () => {
    const root = temporary()
    const outside = temporary()
    mocks.projects.push(project(root))
    await expect(
      invoke(IPC.PROJECT_UPDATE, 'project-1', { id: 'project-2' })
    ).rejects.toThrow('不允许')
    await expect(
      invoke(IPC.PROJECT_UPDATE, 'project-1', { projectPath: outside })
    ).rejects.toThrow('不允许')
    await expect(
      invoke(IPC.PROJECT_UPDATE, 'project-1', {
        config: { directories: { outputsDir: '../escape' } }
      })
    ).rejects.toThrow('相对路径')
    symlinkSync(outside, join(root, 'linked'))
    await expect(
      invoke(IPC.PROJECT_UPDATE, 'project-1', {
        config: { directories: { outputsDir: 'linked' } }
      })
    ).rejects.toThrow('符号链接')
    expect(mocks.updateProject).not.toHaveBeenCalled()
  })

  it('创建不能绑定同一路径两次，不能指定id或未经选定的小说', async () => {
    const root = temporary()
    rememberSelectedDirectory(root)
    mocks.projects.push(project(root))
    const payload = {
      name: 'new',
      projectPath: root,
      visualStyle: '写实',
      targetMedium: '短剧',
      totalEpisodes: 1,
      config: {}
    }
    await expect(invoke(IPC.PROJECT_CREATE, payload)).rejects.toThrow('已关联')
    await expect(
      invoke(IPC.PROJECT_CREATE, { ...payload, id: 'injected' })
    ).rejects.toThrow('不允许')
    mocks.projects.length = 0
    const file = join(root, 'novel.md')
    writeFileSync(file, 'novel')
    await expect(
      invoke(IPC.PROJECT_CREATE, { ...payload, sourceNovelFilePath: file })
    ).rejects.toThrow('选择的文件')
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it('未注册根和路径穿越拒绝FILE_WRITE，即使父目录存在', async () => {
    const root = temporary()
    mkdirSync(join(root, 'nested'))
    await expect(
      invoke(IPC.FILE_WRITE, join(root, 'nested', 'new.md'), 'x')
    ).rejects.toThrow('未授权')
    registerProjectRoot(root)
    await expect(
      invoke(IPC.FILE_WRITE, join(root, '..', 'escape.md'), 'x')
    ).rejects.toThrow('未授权')
  })
})
