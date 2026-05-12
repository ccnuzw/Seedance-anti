import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const showSaveDialog = vi.fn()
const showOpenDialog = vi.fn()
const getFocusedWindow = vi.fn(() => ({ id: 1 }))
const readFile = vi.fn()
const writeFile = vi.fn()
const mkdir = vi.fn()
const readdir = vi.fn()
const copyFile = vi.fn()
const assertRegisteredProjectRoot = vi.fn((input: string) => input)
const resolveEpisodeArtifactPath = vi.fn(
  (projectPath: string, _artifact: string, episodeNum: number) =>
    `${projectPath}/outputs/ep${String(episodeNum).padStart(2, '0')}/prompts.md`
)
const resolveProjectLayout = vi.fn(() => ({
  outputsDir: 'outputs',
  assetsDir: 'assets'
}))

function createDirent(name: string, isDirectory: boolean) {
  return {
    name,
    isDirectory: () => isDirectory
  }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }
  },
  dialog: {
    showSaveDialog,
    showOpenDialog
  },
  BrowserWindow: {
    getFocusedWindow
  }
}))

vi.mock('fs/promises', () => ({
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile
}))

vi.mock('@shared/path-resolver', () => ({
  resolveEpisodeArtifactPath,
  resolveProjectLayout
}))

vi.mock('../security/access-control', () => ({
  assertRegisteredProjectRoot
}))

describe('export-handlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  async function registerHandlers() {
    vi.resetModules()
    const { registerExportHandlers } = await import('./export-handlers')
    registerExportHandlers()
    return await import('@shared/ipc-channels')
  }

  it('导出提示词取消保存时返回 canceled', async () => {
    const { IPC } = await registerHandlers()
    showSaveDialog.mockResolvedValue({
      canceled: true
    })

    const handler = handlers.get(IPC.EXPORT_PROMPTS)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        projectName: '测试项目',
        episodeRange: [1, 2],
        format: 'markdown'
      }
    )

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(result).toEqual({ canceled: true })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('导出 markdown 提示词时会汇总各集内容并写入目标文件', async () => {
    const { IPC } = await registerHandlers()
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/export/prompts.md'
    })
    readFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes('ep01')) {
        return '## 镜头一\n建议时长：10\n内容 A'
      }
      if (filePath.includes('ep02')) {
        return '## 镜头二\n建议时长：12\n内容 B'
      }
      throw new Error('ENOENT')
    })

    const handler = handlers.get(IPC.EXPORT_PROMPTS)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        projectName: '测试项目',
        episodeRange: [1, 2],
        format: 'markdown'
      }
    )

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/export/prompts.md',
      '# EP01\n\n## 镜头一\n建议时长：10\n内容 A\n\n---\n\n# EP02\n\n## 镜头二\n建议时长：12\n内容 B',
      'utf-8'
    )
    expect(result).toEqual({
      success: true,
      path: '/tmp/export/prompts.md',
      count: 2
    })
  })

  it('导出全部产出取消选择目录时返回 canceled', async () => {
    const { IPC } = await registerHandlers()
    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: []
    })

    const handler = handlers.get(IPC.EXPORT_ALL)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        projectName: '测试项目'
      }
    )

    expect(result).toEqual({ canceled: true })
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('导出全部产出时会递归复制 outputs 和 assets', async () => {
    const { IPC } = await registerHandlers()
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/export-root']
    })
    readdir.mockImplementation(async (dirPath: string) => {
      if (dirPath === '/tmp/project/outputs') {
        return [createDirent('ep01', true), createDirent('summary.md', false)]
      }
      if (dirPath === '/tmp/project/outputs/ep01') {
        return [createDirent('scene.md', false)]
      }
      if (dirPath === '/tmp/project/assets') {
        return [createDirent('characters', true)]
      }
      if (dirPath === '/tmp/project/assets/characters') {
        return [createDirent('hero.png', false)]
      }
      return []
    })

    const handler = handlers.get(IPC.EXPORT_ALL)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/project',
        projectName: '测试项目'
      }
    )

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(mkdir).toHaveBeenCalledWith('/tmp/export-root/测试项目-export', {
      recursive: true
    })
    expect(copyFile).toHaveBeenCalledWith(
      '/tmp/project/outputs/summary.md',
      '/tmp/export-root/测试项目-export/outputs/summary.md'
    )
    expect(copyFile).toHaveBeenCalledWith(
      '/tmp/project/outputs/ep01/scene.md',
      '/tmp/export-root/测试项目-export/outputs/ep01/scene.md'
    )
    expect(copyFile).toHaveBeenCalledWith(
      '/tmp/project/assets/characters/hero.png',
      '/tmp/export-root/测试项目-export/assets/characters/hero.png'
    )
    expect(result).toEqual({
      success: true,
      path: '/tmp/export-root/测试项目-export'
    })
  })

  it('导出提示词在路径校验失败时返回结构化错误', async () => {
    const { IPC } = await registerHandlers()
    assertRegisteredProjectRoot.mockImplementationOnce(() => {
      throw new Error('untrusted project root')
    })

    const handler = handlers.get(IPC.EXPORT_PROMPTS)
    const result = await handler?.(
      {},
      {
        projectPath: '/tmp/untrusted',
        projectName: '测试项目',
        episodeRange: [1],
        format: 'json'
      }
    )

    expect(result).toEqual({ error: 'untrusted project root' })
  })
})
