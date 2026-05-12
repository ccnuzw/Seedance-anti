import { v4 as uuid } from 'uuid'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDatabase } from './database'
import {
  createEpisode,
  getEpisode,
  listEpisodes,
  syncEpisodeStatus,
  syncEpisodesFromFilesystem,
  syncSingleEpisodeStatus,
  updateEpisodeStatus
} from './episode-repository'
import {
  addLLMConfig,
  deleteLLMConfig,
  getDefaultLLMConfig,
  listLLMConfigs,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfig
} from './llm-config-repository'
import {
  deleteProject,
  getProject,
  insertProjectRecord,
  listProjects,
  updateProjectRecord
} from './project-repository'
import { getReviews, saveReview } from './review-repository'
import {
  buildDefaultCharacterPromptsTemplate,
  buildDefaultScenePromptsTemplate,
  buildDefaultScriptTemplate,
  buildDefaultPlotBreakdownTemplate,
  buildDefaultSourceTemplate,
  buildDefaultStoryBeatTemplate
} from '@shared/project-bootstrap'
import { importWholeNovelFile } from '../project/novel-importer'
import { normalizeProjectConfig } from '@shared/workflow'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import type { Project } from '@shared/types'
export { migrateLegacyNovelDirectory } from '../project/project-migration'
export { repairProjectIssues } from '../project/project-repair'

function readProjectConfigFromDisk(
  configPath: string
): Partial<Project['config']> | null {
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<
      Project['config']
    >
  } catch {
    return null
  }
}

function initializeProjectDirectories(
  projectPath: string,
  config: Project['config']
): void {
  const layout = resolveProjectLayout(config)
  const requiredDirs = [
    layout.sourceDir,
    layout.sourceNotesDir,
    layout.storyDir,
    layout.storyEpisodeBeatsDir,
    layout.scriptDir,
    layout.assetsDir,
    layout.assetsCharactersDir,
    layout.assetsArtDir,
    layout.assetsScenesDir,
    layout.outputsDir,
    layout.reviewsDir,
    layout.scriptReviewsDir,
    layout.storyboardReviewsDir,
    layout.exportsDir
  ]

  for (const dir of requiredDirs) {
    mkdirSync(join(projectPath, dir), { recursive: true })
  }
}

function initializeProjectTemplates(
  projectPath: string,
  config: Project['config']
): void {
  const sourcePath = resolveProjectArtifactPath(
    projectPath,
    'sourceNovel',
    config
  )
  const plotBreakdownPath = resolveProjectArtifactPath(
    projectPath,
    'plotBreakdown',
    config
  )
  const storyBeatPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyBeat',
    1,
    config
  )
  const scriptPath = resolveEpisodeArtifactPath(
    projectPath,
    'script',
    1,
    config
  )
  const characterPromptsPath = resolveProjectArtifactPath(
    projectPath,
    'characterPrompts',
    config
  )
  const scenePromptsPath = resolveProjectArtifactPath(
    projectPath,
    'scenePrompts',
    config
  )

  if (config.entryStage === 'novel' && !existsSync(sourcePath)) {
    writeFileSync(
      sourcePath,
      buildDefaultSourceTemplate(config.projectName),
      'utf-8'
    )
  }

  if (!existsSync(plotBreakdownPath)) {
    writeFileSync(
      plotBreakdownPath,
      buildDefaultPlotBreakdownTemplate({
        projectName: config.projectName,
        projectType: config.targetMedium || '待确定',
        totalEpisodes: config.totalEpisodes,
        chaptersPerEpisode: config.chaptersPerEpisode || 0
      }),
      'utf-8'
    )
  }

  if (config.entryStage === 'story' && !existsSync(storyBeatPath)) {
    writeFileSync(storyBeatPath, buildDefaultStoryBeatTemplate(1), 'utf-8')
  }

  if (config.entryStage === 'script' && !existsSync(scriptPath)) {
    writeFileSync(scriptPath, buildDefaultScriptTemplate(1), 'utf-8')
  }

  if (!existsSync(characterPromptsPath)) {
    writeFileSync(
      characterPromptsPath,
      buildDefaultCharacterPromptsTemplate(),
      'utf-8'
    )
  }

  if (!existsSync(scenePromptsPath)) {
    writeFileSync(scenePromptsPath, buildDefaultScenePromptsTemplate(), 'utf-8')
  }
}

export async function createProject(data: {
  name: string
  visualStyle: string
  targetMedium: string
  projectPath: string
  totalEpisodes: number
  config: Partial<Project['config']>
  sourceNovelFilePath?: string
}): Promise<Project> {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  const configPath = resolveProjectArtifactPath(
    data.projectPath,
    'projectConfig'
  )
  mkdirSync(data.projectPath, { recursive: true })

  const diskConfig = readProjectConfigFromDisk(configPath)
  const normalizedConfig = normalizeProjectConfig({
    ...(diskConfig || {}),
    ...(data.config || {}),
    projectName:
      data.config?.projectName ||
      data.name ||
      diskConfig?.projectName ||
      '未命名项目',
    totalEpisodes:
      data.config?.totalEpisodes ||
      data.totalEpisodes ||
      diskConfig?.totalEpisodes ||
      0,
    visualStyle:
      data.config?.visualStyle ||
      data.visualStyle ||
      diskConfig?.visualStyle ||
      '',
    targetMedium:
      data.config?.targetMedium ||
      data.targetMedium ||
      diskConfig?.targetMedium ||
      '',
    createdAt: diskConfig?.createdAt || data.config?.createdAt || now,
    directories: {
      ...(diskConfig?.directories || {}),
      ...(data.config?.directories || {})
    },
    pipelineSettings:
      data.config?.pipelineSettings || diskConfig?.pipelineSettings
  })

  writeFileSync(configPath, JSON.stringify(normalizedConfig, null, 2), 'utf-8')
  initializeProjectDirectories(data.projectPath, normalizedConfig)
  if (data.sourceNovelFilePath && normalizedConfig.entryStage === 'novel') {
    importWholeNovelFile({
      sourceFilePath: data.sourceNovelFilePath,
      projectPath: data.projectPath,
      config: normalizedConfig
    })
  }
  if (!diskConfig) {
    initializeProjectTemplates(data.projectPath, normalizedConfig)
  }
  data.name = normalizedConfig.projectName
  data.visualStyle = normalizedConfig.visualStyle
  data.targetMedium = normalizedConfig.targetMedium
  data.totalEpisodes = normalizedConfig.totalEpisodes
  data.config = normalizedConfig

  insertProjectRecord(db, {
    id,
    name: data.name,
    visualStyle: data.visualStyle,
    targetMedium: data.targetMedium,
    projectPath: data.projectPath,
    totalEpisodes: data.totalEpisodes,
    configJson: JSON.stringify(data.config),
    createdAt: now,
    updatedAt: now
  })

  await syncEpisodesFromFilesystem(id, data.projectPath, data.totalEpisodes)

  return getProject(id)!
}

export async function updateProject(data: {
  id: string
  name?: string
  visualStyle?: string
  targetMedium?: string
  totalEpisodes?: number
  config?: Partial<Project['config']>
}): Promise<Project> {
  const currentProject = getProject(data.id)
  if (!currentProject) {
    throw new Error(`项目不存在: ${data.id}`)
  }

  const now = new Date().toISOString()
  const configPath = resolveProjectArtifactPath(
    currentProject.projectPath,
    'projectConfig',
    currentProject.config
  )
  const diskConfig = readProjectConfigFromDisk(configPath)
  const normalizedConfig = normalizeProjectConfig({
    ...(currentProject.config || {}),
    ...(diskConfig || {}),
    ...(data.config || {}),
    projectName:
      data.name ||
      data.config?.projectName ||
      diskConfig?.projectName ||
      currentProject.name,
    totalEpisodes:
      data.totalEpisodes ??
      data.config?.totalEpisodes ??
      diskConfig?.totalEpisodes ??
      currentProject.totalEpisodes,
    visualStyle:
      data.visualStyle ??
      data.config?.visualStyle ??
      diskConfig?.visualStyle ??
      currentProject.visualStyle,
    targetMedium:
      data.targetMedium ??
      data.config?.targetMedium ??
      diskConfig?.targetMedium ??
      currentProject.targetMedium,
    createdAt:
      currentProject.config.createdAt ||
      diskConfig?.createdAt ||
      currentProject.createdAt,
    directories: {
      ...(currentProject.config.directories || {}),
      ...(diskConfig?.directories || {}),
      ...(data.config?.directories || {})
    },
    pipelineSettings:
      data.config?.pipelineSettings ||
      diskConfig?.pipelineSettings ||
      currentProject.config.pipelineSettings
  })

  writeFileSync(configPath, JSON.stringify(normalizedConfig, null, 2), 'utf-8')
  initializeProjectDirectories(currentProject.projectPath, normalizedConfig)

  updateProjectRecord({
    id: currentProject.id,
    name: normalizedConfig.projectName,
    visualStyle: normalizedConfig.visualStyle,
    targetMedium: normalizedConfig.targetMedium,
    totalEpisodes: normalizedConfig.totalEpisodes,
    configJson: JSON.stringify(normalizedConfig),
    updatedAt: now
  })

  return getProject(currentProject.id)!
}

export {
  addLLMConfig,
  createEpisode,
  deleteLLMConfig,
  deleteProject,
  getDefaultLLMConfig,
  getEpisode,
  getProject,
  getReviews,
  listEpisodes,
  listLLMConfigs,
  listProjects,
  resolveLLMConfigForExecution,
  saveReview,
  setDefaultLLMConfig,
  syncEpisodeStatus,
  syncEpisodesFromFilesystem,
  syncSingleEpisodeStatus,
  updateEpisodeStatus,
  updateLLMConfig
}
