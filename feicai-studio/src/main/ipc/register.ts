import { app, dialog } from 'electron'
import { readdir } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { IPC } from '@shared/ipc-channels'
import { resolveProjectLayout } from '@shared/path-resolver'
import type { ProjectConfig } from '@shared/types'
import { registerPipelineHandlers } from './pipeline-handlers'
import { registerAssetHandlers } from './asset-handlers'
import { registerExportHandlers } from './export-handlers'
import { detectProjectDirectory } from '../project/project-detector'
import {
  createProject,
  deleteProject,
  getRegisteredProject,
  getRegisteredProjectPlotBreakdownSummary,
  listRegisteredProjectSourceChapters,
  listProjectEpisodes,
  listRegisteredProjects,
  migrateLegacyNovelDirectory,
  repairProjectIssues,
  syncRegisteredProjectEpisodeStatus,
  syncRegisteredProjectStatus,
  updateProject
} from '../services/project-service'
import {
  addLLMConfig,
  deleteLLMConfig,
  listLLMConfigs,
  listLLMModels,
  setDefaultLLM,
  testLLMConnection,
  updateLLMConfig
} from '../services/llm-service'
import { getProjectPipelineState } from '../services/project-state-service'
import {
  assertEpisodeNumber,
  assertNonEmptyString,
  assertPathWithinProject,
  assertProjectFileReadAllowed,
  assertProjectFileWriteAllowed,
  assertRegisteredProjectRoot,
  assertSelectedFileAllowed,
  assertTrustedProjectSelection,
  isMissingFileError,
  isSameProjectRoot,
  registerProjectRoot,
  registerProjectRoots,
  refreshRegisteredProjectRoots,
  rememberSelectedDirectory,
  rememberSelectedFile
} from '../security/access-control'
import { registerSafeIpcHandler as handle } from '../security/safe-ipc'
import { registerMutationHandler as mutate } from './mutation-handler'
import { withExecutionLease } from '../services/batch-execution-lease'
import {
  assertAllowedKeys,
  assertLLMConfig,
  assertProjectConfig,
  assertRecord,
  parseProjectInput,
  parseProjectUpdate
} from '../security/input-validation'
import {
  atomicCompareAndWriteFile,
  atomicWriteFile,
  FileConflictError,
  readRegularFile
} from '../io/atomic-file'

function registeredProject(id: unknown, projectPath?: unknown) {
  assertNonEmptyString(id, '项目ID')
  const project = getRegisteredProject(id)
  if (!project) throw new Error('项目不存在')
  const root = registerProjectRoot(project.projectPath)
  if (projectPath !== undefined) {
    assertNonEmptyString(projectPath, '项目目录')
    if (assertRegisteredProjectRoot(projectPath) !== root)
      throw new Error('项目ID与目录不一致')
  }
  return { project, root }
}

function assertLayoutPaths(
  root: string,
  config?: Partial<ProjectConfig>,
  patch = false
): void {
  if (config) assertProjectConfig(config, patch)
  // Layout resolution must not fill defaults into a settings patch before DB merge.
  const layoutConfig = patch
    ? { ...config, pipelineSettings: undefined }
    : config
  for (const directory of Object.values(resolveProjectLayout(layoutConfig))) {
    assertPathWithinProject(root, join(root, directory))
  }
  assertPathWithinProject(root, join(root, 'project-config.json'))
}

/** Inspect only dialog-selected directories, without letting the detector follow
 * config or candidate-directory links before it has returned its report. */
async function inspectProject(root: string) {
  const candidates = [root]
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (
      entry.isDirectory() ||
      ['小说', 'novel', 'project', '项目'].includes(entry.name)
    ) {
      candidates.push(assertPathWithinProject(root, join(root, entry.name)))
    }
  }
  for (const candidate of candidates) {
    assertLayoutPaths(candidate)
    try {
      const content = (
        await readRegularFile(
          assertPathWithinProject(root, join(candidate, 'project-config.json'))
        )
      ).toString('utf8')
      let config: unknown
      try {
        config = JSON.parse(content)
      } catch (error) {
        if (error instanceof SyntaxError) continue // Detector reports malformed configuration for repair.
        throw error
      }
      assertProjectConfig(config)
      assertLayoutPaths(candidate, config)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
  }
  return detectProjectDirectory(root)
}

export function registerAllHandlers(): void {
  registerPipelineHandlers()
  registerAssetHandlers()
  registerExportHandlers()

  handle(IPC.PROJECT_LIST, async () => {
    const projects = listRegisteredProjects()
    refreshRegisteredProjectRoots(
      projects.map((project) => project.projectPath)
    )
    return projects
  })
  handle(IPC.PROJECT_GET, async (_event, id: unknown) => {
    assertNonEmptyString(id, '项目ID')
    const project = getRegisteredProject(id)
    if (project) registerProjectRoots([project.projectPath])
    return project
  })
  handle(IPC.PROJECT_DETECT_DIR, async (_event, path: unknown) => {
    assertNonEmptyString(path, '目录')
    const root = assertTrustedProjectSelection(path)
    const detected = await inspectProject(root)
    rememberSelectedDirectory(
      assertPathWithinProject(root, detected.resolvedPath)
    )
    return detected
  })
  handle(IPC.PROJECT_INSPECT, async (_event, path: unknown) => {
    assertNonEmptyString(path, '项目目录')
    return inspectProject(assertRegisteredProjectRoot(path))
  })
  mutate(IPC.PROJECT_MIGRATE_LEGACY_NOVEL, async (_event, path: unknown) => {
    assertNonEmptyString(path, '项目目录')
    const root = assertRegisteredProjectRoot(path)
    await inspectProject(root)
    return migrateLegacyNovelDirectory(root)
  })
  handle(IPC.PROJECT_REPAIR, async (_event, params: unknown) => {
    assertRecord(params)
    assertAllowedKeys(params, [
      'projectPath',
      'actionIds',
      'trustMode',
      'dryRun'
    ])
    assertNonEmptyString(params.projectPath, '项目目录')
    if (params.trustMode !== 'registered' && params.trustMode !== 'selected')
      throw new Error('无效授权模式')
    const choices = [
      'apply_suggested_config',
      'create_missing_directories',
      'create_missing_templates',
      'migrate_legacy_novel'
    ] as const
    if (
      !Array.isArray(params.actionIds) ||
      params.actionIds.some((action) => !choices.includes(action))
    )
      throw new Error('无效修复动作')
    if (params.dryRun !== undefined && typeof params.dryRun !== 'boolean')
      throw new Error('dryRun必须为布尔值')
    const { projectPath, actionIds, trustMode, dryRun } = params
    const repair = async () => {
      const root =
        trustMode === 'registered'
          ? assertRegisteredProjectRoot(projectPath)
          : assertTrustedProjectSelection(projectPath)
      await inspectProject(root)
      return repairProjectIssues({
        projectPath: root,
        actionIds,
        trustMode,
        dryRun
      })
    }
    // A repair preview reads only; real repair owns the lease before lookup/I/O.
    return dryRun === true
      ? repair()
      : withExecutionLease(IPC.PROJECT_REPAIR, repair)
  })
  handle(IPC.PROJECT_LIST_SOURCE_CHAPTERS, async (_event, id: unknown) => {
    const { project } = registeredProject(id)
    return listRegisteredProjectSourceChapters(project.id)
  })
  handle(
    IPC.PROJECT_GET_PLOT_BREAKDOWN_SUMMARY,
    async (_event, id: unknown) => {
      const { project } = registeredProject(id)
      return getRegisteredProjectPlotBreakdownSummary(project.id)
    }
  )
  mutate(IPC.PROJECT_CREATE, async (_event, value: unknown) => {
    const data = parseProjectInput(value)
    const root = assertTrustedProjectSelection(data.projectPath)
    if (
      listRegisteredProjects().some((project) =>
        isSameProjectRoot(project.projectPath, root)
      )
    )
      throw new Error('该目录已关联其他项目')
    assertLayoutPaths(root, data.config, true)
    const sourceNovelFilePath =
      data.sourceNovelFilePath === undefined
        ? undefined
        : assertSelectedFileAllowed(data.sourceNovelFilePath)
    const project = await createProject({
      ...data,
      projectPath: root,
      sourceNovelFilePath
    })
    if (!isSameProjectRoot(project.projectPath, root))
      throw new Error('创建结果项目目录不一致')
    registerProjectRoot(root)
    return project
  })
  mutate(IPC.PROJECT_UPDATE, async (_event, id: unknown, value: unknown) => {
    const { project, root } = registeredProject(id)
    const data = parseProjectUpdate(value)
    assertLayoutPaths(root, data.config || project.config, !!data.config)
    const updated = await updateProject(project.id, data)
    if (
      !isSameProjectRoot(updated.projectPath, root) ||
      updated.id !== project.id
    )
      throw new Error('更新结果项目身份不一致')
    return updated
  })
  mutate(IPC.PROJECT_DELETE, async (_event, id: unknown) => {
    assertNonEmptyString(id, '项目ID')
    const project = getRegisteredProject(id)
    if (!project) throw new Error('项目不存在')
    deleteProject(project.id)
    refreshRegisteredProjectRoots(
      listRegisteredProjects().map((item) => item.projectPath)
    )
    return { success: true }
  })

  handle(IPC.LLM_LIST_CONFIGS, async () => listLLMConfigs())
  mutate(IPC.LLM_ADD_CONFIG, async (_event, data: unknown) => {
    assertLLMConfig(data)
    if (data.id !== undefined) throw new Error('新增配置不能指定ID')
    return addLLMConfig(data)
  })
  mutate(IPC.LLM_DELETE_CONFIG, async (_event, id: unknown) => {
    assertNonEmptyString(id, '配置ID')
    deleteLLMConfig(id)
    return { success: true }
  })
  mutate(IPC.LLM_UPDATE_CONFIG, async (_event, id: unknown, data: unknown) => {
    assertNonEmptyString(id, '配置ID')
    assertLLMConfig(data, true)
    if (data.id !== undefined && data.id !== id) throw new Error('配置ID不一致')
    const patch: Partial<typeof data> = { ...data }
    delete patch.id
    updateLLMConfig(id, patch)
    return { success: true }
  })
  handle(IPC.LLM_TEST_CONNECTION, async (_event, data: unknown) => {
    assertLLMConfig(data)
    return testLLMConnection(data)
  })
  mutate(IPC.LLM_SET_DEFAULT, async (_event, id: unknown) => {
    assertNonEmptyString(id, '配置ID')
    setDefaultLLM(id)
    return { success: true }
  })
  handle(IPC.LLM_LIST_MODELS, async (_event, payload: unknown) => {
    assertRecord(payload)
    assertAllowedKeys(payload, ['baseUrl', 'apiKey', 'configId'])
    assertNonEmptyString(payload.baseUrl, '服务地址')
    if (payload.apiKey !== undefined && typeof payload.apiKey !== 'string')
      throw new Error('apiKey必须为字符串')
    if (payload.configId !== undefined)
      assertNonEmptyString(payload.configId, '配置ID')
    return listLLMModels({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      configId: payload.configId
    })
  })

  handle(IPC.FILE_READ, async (_event, path: unknown) => {
    assertNonEmptyString(path, '文件路径')
    const target = assertProjectFileReadAllowed(path)
    try {
      return (await readRegularFile(target)).toString('utf8')
    } catch (error) {
      if (isMissingFileError(error)) return null
      throw error
    }
  })
  mutate(
    IPC.FILE_WRITE,
    async (
      _event,
      path: unknown,
      content: unknown,
      expectedContent?: unknown
    ) => {
      assertNonEmptyString(path, '文件路径')
      if (typeof content !== 'string') throw new Error('文件内容必须为字符串')
      if (
        expectedContent !== undefined &&
        expectedContent !== null &&
        typeof expectedContent !== 'string'
      )
        throw new Error('预期文件内容无效')
      const target = assertProjectFileWriteAllowed(path)
      const configProject =
        basename(target) === 'project-config.json'
          ? listRegisteredProjects().find((project) =>
              isSameProjectRoot(project.projectPath, dirname(target))
            )
          : undefined
      if (configProject) {
        const config: unknown = JSON.parse(content)
        assertProjectConfig(config)
        assertLayoutPaths(
          assertRegisteredProjectRoot(configProject.projectPath),
          config
        )
      }
      try {
        if (expectedContent === undefined)
          await atomicWriteFile(target, content)
        else await atomicCompareAndWriteFile(target, content, expectedContent)
        return { success: true }
      } catch (error) {
        if (error instanceof FileConflictError)
          return { success: false, error: 'FILE_CONFLICT' }
        throw error
      }
    }
  )
  handle(IPC.FILE_SELECT_DIR, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled || !result.filePaths.length
      ? null
      : rememberSelectedDirectory(result.filePaths[0])
  })
  handle(IPC.FILE_SELECT_FILE, async (_event, value?: unknown) => {
    let filters: Electron.FileFilter[] | undefined
    if (value !== undefined) {
      if (!Array.isArray(value)) throw new Error('文件筛选条件必须为数组')
      filters = value.map((filter: unknown) => {
        assertRecord(filter)
        assertAllowedKeys(filter, ['name', 'extensions'])
        assertNonEmptyString(filter.name, '筛选名称')
        if (
          !Array.isArray(filter.extensions) ||
          !filter.extensions.length ||
          filter.extensions.some(
            (extension) =>
              typeof extension !== 'string' ||
              !/^(?:\*|[a-zA-Z0-9]+)$/.test(extension)
          )
        )
          throw new Error('无效文件扩展名')
        return { name: filter.name, extensions: filter.extensions }
      })
    }
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'Markdown', extensions: ['md'] }]
    })
    return result.canceled || !result.filePaths.length
      ? null
      : rememberSelectedFile(result.filePaths[0])
  })

  handle(IPC.PROJECT_GET_STATUS, async (_event, id: unknown) => {
    assertNonEmptyString(id, '项目ID')
    if (!getRegisteredProject(id)) throw new Error('项目不存在')
    return listProjectEpisodes(id)
  })
  mutate(
    IPC.PROJECT_SYNC_STATUS,
    async (_event, id: unknown, path: unknown) => {
      assertNonEmptyString(path, '项目目录')
      const { project, root } = registeredProject(id, path)
      return syncRegisteredProjectStatus({
        projectId: project.id,
        projectPath: root
      })
    }
  )
  mutate(IPC.PROJECT_SYNC_EPISODE_STATUS, async (_event, params: unknown) => {
    assertRecord(params)
    assertAllowedKeys(params, ['projectId', 'projectPath', 'episodeNum'])
    assertNonEmptyString(params.projectPath, '项目目录')
    assertEpisodeNumber(params.episodeNum)
    const { project, root } = registeredProject(
      params.projectId,
      params.projectPath
    )
    return syncRegisteredProjectEpisodeStatus({
      projectId: project.id,
      projectPath: root,
      episodeNum: params.episodeNum
    })
  })
  handle(IPC.PROJECT_GET_PIPELINE_STATE, async (_event, path: unknown) => {
    assertNonEmptyString(path, '项目目录')
    const root = assertRegisteredProjectRoot(path)
    const project = listRegisteredProjects().find((item) =>
      isSameProjectRoot(item.projectPath, root)
    )
    if (!project) throw new Error('项目未注册')
    assertLayoutPaths(root, project.config)
    return getProjectPipelineState(root)
  })
  handle(IPC.APP_GET_VERSION, async () => app.getVersion())
}
