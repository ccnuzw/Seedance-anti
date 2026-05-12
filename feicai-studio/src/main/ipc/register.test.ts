import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const readFile = vi.fn()
const writeFile = vi.fn()
const listRegisteredProjects = vi.fn()
const listProjectEpisodes = vi.fn()
const syncRegisteredProjectStatus = vi.fn()
const syncRegisteredProjectEpisodeStatus = vi.fn()
const setDefaultLLM = vi.fn()
const deleteLLMConfig = vi.fn()
const updateLLMConfig = vi.fn()
const addLLMConfig = vi.fn()
const getRegisteredProject = vi.fn()
const listLLMConfigs = vi.fn()
const listLLMModels = vi.fn()
const testLLMConnection = vi.fn()
const getProjectPipelineState = vi.fn()
const createProject = vi.fn()
const deleteProject = vi.fn()
const detectProjectDirectory = vi.fn()
const migrateLegacyNovelDirectory = vi.fn()
const repairProjectIssues = vi.fn()
const registerProjectRoot = vi.fn()
const registerProjectRoots = vi.fn()
const assertRegisteredProjectRoot = vi.fn((input: string) => input)
const assertTrustedProjectSelection = vi.fn((input: string) => input)
const assertProjectFileReadAllowed = vi.fn((input: string) => input)
const assertProjectFileWriteAllowed = vi.fn((input: string) => input)
const rememberSelectedDirectory = vi.fn((input: string) => input)
const rememberSelectedFile = vi.fn((input: string) => input)
const registerPipelineHandlers = vi.fn()
const registerAssetHandlers = vi.fn()
const registerExportHandlers = vi.fn()
const existsSync = vi.fn()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }
  },
  dialog: {
    showOpenDialog
  }
}))

vi.mock('fs/promises', () => ({
  readFile,
  writeFile
}))

vi.mock('fs', () => ({
  existsSync
}))

vi.mock('../services/project-service', () => ({
  listRegisteredProjects,
  getRegisteredProject,
  createProject,
  deleteProject,
  listProjectEpisodes,
  syncRegisteredProjectStatus,
  syncRegisteredProjectEpisodeStatus,
  migrateLegacyNovelDirectory,
  repairProjectIssues
}))

vi.mock('../services/llm-service', () => ({
  listLLMConfigs,
  addLLMConfig,
  deleteLLMConfig,
  updateLLMConfig,
  setDefaultLLM,
  testLLMConnection,
  listLLMModels
}))

vi.mock('../services/project-state-service', () => ({
  getProjectPipelineState
}))

vi.mock('../project/project-detector', () => ({
  detectProjectDirectory
}))

vi.mock('../security/access-control', () => ({
  assertProjectFileReadAllowed,
  assertProjectFileWriteAllowed,
  assertRegisteredProjectRoot,
  assertTrustedProjectSelection,
  registerProjectRoot,
  registerProjectRoots,
  rememberSelectedDirectory,
  rememberSelectedFile
}))

vi.mock('./pipeline-handlers', () => ({
  registerPipelineHandlers
}))

vi.mock('./asset-handlers', () => ({
  registerAssetHandlers
}))

vi.mock('./export-handlers', () => ({
  registerExportHandlers
}))

describe('registerAllHandlers', async () => {
  const { registerAllHandlers } = await import('./register')
  const { IPC } = await import('@shared/ipc-channels')

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerAllHandlers()
  })

  it('初始化时会注册 pipeline asset export 子 handlers', () => {
    expect(registerPipelineHandlers).toHaveBeenCalledTimes(1)
    expect(registerAssetHandlers).toHaveBeenCalledTimes(1)
    expect(registerExportHandlers).toHaveBeenCalledTimes(1)
  })

  it('列出项目时会注册所有项目根目录', async () => {
    listRegisteredProjects.mockReturnValue([
      { id: 'project-1', projectPath: '/tmp/project-1' },
      { id: 'project-2', projectPath: '/tmp/project-2' }
    ])

    const handler = handlers.get(IPC.PROJECT_LIST)
    const result = await handler?.({})

    expect(registerProjectRoots).toHaveBeenCalledWith([
      '/tmp/project-1',
      '/tmp/project-2'
    ])
    expect(result).toEqual([
      { id: 'project-1', projectPath: '/tmp/project-1' },
      { id: 'project-2', projectPath: '/tmp/project-2' }
    ])
  })

  it('获取单个项目时会注册该项目根目录', async () => {
    getRegisteredProject.mockReturnValue({
      id: 'project-1',
      projectPath: '/tmp/project-1'
    })

    const handler = handlers.get(IPC.PROJECT_GET)
    const result = await handler?.({}, 'project-1')

    expect(getRegisteredProject).toHaveBeenCalledWith('project-1')
    expect(registerProjectRoot).toHaveBeenCalledWith('/tmp/project-1')
    expect(result).toEqual({
      id: 'project-1',
      projectPath: '/tmp/project-1'
    })
  })

  it('读取项目流水线状态时会先校验路径再交给项目状态 service', async () => {
    getProjectPipelineState.mockResolvedValue({
      updatedAt: '2026-05-07T00:00:00.000Z'
    })

    const handler = handlers.get(IPC.PROJECT_GET_PIPELINE_STATE)
    const result = await handler?.({}, '/tmp/project')

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(getProjectPipelineState).toHaveBeenCalledWith('/tmp/project')
    expect(result).toEqual({ updatedAt: '2026-05-07T00:00:00.000Z' })
  })

  it('列出远程模型时会将参数转交给 llm service', async () => {
    listLLMModels.mockResolvedValue({
      success: true,
      models: [{ id: 'gpt-4.1', name: 'gpt-4.1', owner: 'openai' }],
      message: '获取到 1 个模型'
    })

    const handler = handlers.get(IPC.LLM_LIST_MODELS)
    const payload = { baseUrl: 'https://example.com', configId: 'cfg-1' }
    const result = await handler?.({}, payload)

    expect(listLLMModels).toHaveBeenCalledWith(payload)
    expect(result).toEqual({
      success: true,
      models: [{ id: 'gpt-4.1', name: 'gpt-4.1', owner: 'openai' }],
      message: '获取到 1 个模型'
    })
  })

  it('读取缺失文件时会返回 null 而不是抛出 ENOENT', async () => {
    existsSync.mockReturnValue(true)
    readFile.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    )

    const handler = handlers.get(IPC.FILE_READ)
    const result = await handler?.({}, '/tmp/missing.md')

    expect(assertProjectFileReadAllowed).toHaveBeenCalledWith('/tmp/missing.md')
    expect(readFile).toHaveBeenCalledWith('/tmp/missing.md', 'utf-8')
    expect(result).toBeNull()
  })

  it('文件不存在时不会尝试读取并直接返回 null', async () => {
    existsSync.mockReturnValue(false)

    const handler = handlers.get(IPC.FILE_READ)
    const result = await handler?.({}, '/tmp/missing.md')

    expect(assertProjectFileReadAllowed).toHaveBeenCalledWith('/tmp/missing.md')
    expect(readFile).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('迁移旧版小说目录时会先校验项目根目录', async () => {
    migrateLegacyNovelDirectory.mockResolvedValue({
      success: true,
      migrated: true,
      sourcePath: '/tmp/project/source/novel.md',
      legacyDirPath: '/tmp/project/novel',
      migratedFiles: 30,
      message: '已迁移 30 个章节到标准小说原文'
    })

    const handler = handlers.get(IPC.PROJECT_MIGRATE_LEGACY_NOVEL)
    const result = await handler?.({}, '/tmp/project')

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(migrateLegacyNovelDirectory).toHaveBeenCalledWith('/tmp/project')
    expect(result).toEqual({
      success: true,
      migrated: true,
      sourcePath: '/tmp/project/source/novel.md',
      legacyDirPath: '/tmp/project/novel',
      migratedFiles: 30,
      message: '已迁移 30 个章节到标准小说原文'
    })
  })

  it('检查已导入项目目录时会走已注册项目根目录校验', async () => {
    detectProjectDirectory.mockReturnValue({
      resolvedPath: '/tmp/project',
      configPath: '/tmp/project/project-config.json',
      scriptDir: '/tmp/project/scripts',
      outputsDir: '/tmp/project/outputs'
    })

    const handler = handlers.get(IPC.PROJECT_INSPECT)
    const result = await handler?.({}, '/tmp/project')

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(assertTrustedProjectSelection).not.toHaveBeenCalledWith(
      '/tmp/project'
    )
    expect(detectProjectDirectory).toHaveBeenCalledWith('/tmp/project')
    expect(result).toEqual({
      resolvedPath: '/tmp/project',
      configPath: '/tmp/project/project-config.json',
      scriptDir: '/tmp/project/scripts',
      outputsDir: '/tmp/project/outputs'
    })
  })

  it('创建项目时会校验受信目录并注册新项目根目录', async () => {
    createProject.mockResolvedValue({
      id: 'project-1',
      projectPath: '/tmp/project'
    })

    const handler = handlers.get(IPC.PROJECT_CREATE)
    const payload = {
      name: '项目',
      projectPath: '/tmp/project',
      visualStyle: '现实',
      targetMedium: '短剧',
      totalEpisodes: 10,
      config: { projectName: '项目' }
    }
    const result = await handler?.({}, payload)

    expect(assertTrustedProjectSelection).toHaveBeenCalledWith('/tmp/project')
    expect(createProject).toHaveBeenCalledWith({
      ...payload,
      projectPath: '/tmp/project'
    })
    expect(registerProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(result).toEqual({
      id: 'project-1',
      projectPath: '/tmp/project'
    })
  })

  it('修复已导入项目问题时会走已注册项目根目录校验', async () => {
    repairProjectIssues.mockResolvedValue({
      success: true,
      appliedActions: ['apply_suggested_config'],
      message: '已执行 1 项修复动作',
      dryRun: false,
      plannedChanges: ['更新或生成项目配置: /tmp/project/project-config.json'],
      readyItems: [
        {
          label: '项目配置',
          path: '/tmp/project/project-config.json',
          exists: true
        }
      ],
      detected: {
        resolvedPath: '/tmp/project',
        configPath: '/tmp/project/project-config.json',
        scriptDir: '/tmp/project/scripts',
        outputsDir: '/tmp/project/outputs'
      }
    })

    const handler = handlers.get(IPC.PROJECT_REPAIR)
    const payload = {
      projectPath: '/tmp/project',
      actionIds: ['apply_suggested_config'],
      trustMode: 'registered'
    }
    const result = await handler?.({}, payload)

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(repairProjectIssues).toHaveBeenCalledWith(payload)
    expect(result).toEqual({
      success: true,
      appliedActions: ['apply_suggested_config'],
      message: '已执行 1 项修复动作',
      dryRun: false,
      plannedChanges: ['更新或生成项目配置: /tmp/project/project-config.json'],
      readyItems: [
        {
          label: '项目配置',
          path: '/tmp/project/project-config.json',
          exists: true
        }
      ],
      detected: {
        resolvedPath: '/tmp/project',
        configPath: '/tmp/project/project-config.json',
        scriptDir: '/tmp/project/scripts',
        outputsDir: '/tmp/project/outputs'
      }
    })
  })

  it('修复未导入目录问题时会走受信选择目录校验', async () => {
    repairProjectIssues.mockResolvedValue({ success: true })

    const handler = handlers.get(IPC.PROJECT_REPAIR)
    const payload = {
      projectPath: '/tmp/new-project',
      actionIds: ['apply_suggested_config'],
      trustMode: 'selected'
    }

    const result = await handler?.({}, payload)

    expect(assertTrustedProjectSelection).toHaveBeenCalledWith(
      '/tmp/new-project'
    )
    expect(assertRegisteredProjectRoot).not.toHaveBeenCalledWith(
      '/tmp/new-project'
    )
    expect(repairProjectIssues).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ success: true })
  })

  it('同步项目状态时会先校验项目根目录', async () => {
    syncRegisteredProjectStatus.mockResolvedValue([
      { id: 'episode-1', episodeNumber: 1 }
    ])

    const handler = handlers.get(IPC.PROJECT_SYNC_STATUS)
    const result = await handler?.({}, 'project-1', '/tmp/project')

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(syncRegisteredProjectStatus).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project'
    })
    expect(result).toEqual([{ id: 'episode-1', episodeNumber: 1 }])
  })

  it('同步单集状态时会先校验项目根目录', async () => {
    syncRegisteredProjectEpisodeStatus.mockResolvedValue({
      id: 'episode-2',
      episodeNumber: 2
    })

    const handler = handlers.get(IPC.PROJECT_SYNC_EPISODE_STATUS)
    const payload = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 2
    }
    const result = await handler?.({}, payload)

    expect(assertRegisteredProjectRoot).toHaveBeenCalledWith('/tmp/project')
    expect(syncRegisteredProjectEpisodeStatus).toHaveBeenCalledWith(payload)
    expect(result).toEqual({ id: 'episode-2', episodeNumber: 2 })
  })

  it('写文件时会先校验路径并以 utf-8 写入', async () => {
    const handler = handlers.get(IPC.FILE_WRITE)
    const result = await handler?.({}, '/tmp/project/file.md', '# content')

    expect(assertProjectFileWriteAllowed).toHaveBeenCalledWith(
      '/tmp/project/file.md'
    )
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/project/file.md',
      '# content',
      'utf-8'
    )
    expect(result).toEqual({ success: true })
  })

  it('选择目录取消时返回 null', async () => {
    showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: []
    })

    const handler = handlers.get(IPC.FILE_SELECT_DIR)
    const result = await handler?.({})

    expect(result).toBeNull()
    expect(rememberSelectedDirectory).not.toHaveBeenCalled()
  })
})
