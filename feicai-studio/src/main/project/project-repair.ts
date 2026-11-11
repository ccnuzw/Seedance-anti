import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  buildDefaultCharacterPromptsTemplate,
  buildDefaultPlotBreakdownTemplate,
  buildDefaultScenePromptsTemplate,
  buildDefaultScriptTemplate,
  buildDefaultSourceTemplate,
  buildDefaultStoryBeatTemplate
} from '@shared/project-bootstrap'
import { mergeProjectConfig } from '@shared/project-config'
import {
  type ProjectRepairActionId,
  type ProjectReadyItem,
  type ProjectRepairIssueParams
} from '@shared/project-detection'
import type { ProjectConfig } from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import { detectProjectDirectory } from './project-detector'
import { migrateLegacyNovelDirectory } from './project-migration'
import { updateProjectRecordByPath } from '../db/project-repository'
import { assertPathWithinProject } from '../security/access-control'
import { atomicWriteFile } from '../io/atomic-file'

export interface ProjectRepairResult {
  success: boolean
  appliedActions: ProjectRepairActionId[]
  message: string
  detected: ReturnType<typeof detectProjectDirectory>
  dryRun: boolean
  plannedChanges: string[]
  readyItems: ProjectReadyItem[]
}

function readDiskConfig(configPath: string): Partial<ProjectConfig> | null {
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(
      readFileSync(configPath, 'utf-8')
    ) as Partial<ProjectConfig>
  } catch {
    return null
  }
}

async function writeNormalizedConfig(
  projectPath: string,
  config: ProjectConfig
): Promise<void> {
  const configPath = resolveProjectArtifactPath(
    projectPath,
    'projectConfig',
    config
  )
  await atomicWriteFile(
    assertPathWithinProject(projectPath, configPath),
    JSON.stringify(config, null, 2)
  )
}

function createMissingDirectories(
  projectPath: string,
  config: ProjectConfig
): void {
  const layout = resolveProjectLayout(config)
  const dirs = [
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
    layout.storyReviewsDir,
    layout.scriptReviewsDir,
    layout.storyboardReviewsDir,
    layout.exportsDir
  ]

  for (const dir of dirs) {
    mkdirSync(assertPathWithinProject(projectPath, join(projectPath, dir)), {
      recursive: true
    })
  }
}

function collectReadyItems(
  projectPath: string,
  config: ProjectConfig
): ProjectReadyItem[] {
  const items: ProjectReadyItem[] = [
    {
      label: '项目配置',
      path: resolveProjectArtifactPath(projectPath, 'projectConfig', config),
      exists: existsSync(
        resolveProjectArtifactPath(projectPath, 'projectConfig', config)
      )
    },
    {
      label: '小说原文',
      path: resolveProjectArtifactPath(projectPath, 'sourceNovel', config),
      exists: existsSync(
        resolveProjectArtifactPath(projectPath, 'sourceNovel', config)
      )
    },
    {
      label: '剧情库存',
      path: resolveProjectArtifactPath(projectPath, 'plotBreakdown', config),
      exists: existsSync(
        resolveProjectArtifactPath(projectPath, 'plotBreakdown', config)
      )
    },
    {
      label: '首集剧情拆解',
      path: resolveEpisodeArtifactPath(projectPath, 'storyBeat', 1, config),
      exists: existsSync(
        resolveEpisodeArtifactPath(projectPath, 'storyBeat', 1, config)
      )
    },
    {
      label: '首集剧本',
      path: resolveEpisodeArtifactPath(projectPath, 'script', 1, config),
      exists: existsSync(
        resolveEpisodeArtifactPath(projectPath, 'script', 1, config)
      )
    },
    {
      label: '角色素材库',
      path: resolveProjectArtifactPath(projectPath, 'characterPrompts', config),
      exists: existsSync(
        resolveProjectArtifactPath(projectPath, 'characterPrompts', config)
      )
    },
    {
      label: '场景素材库',
      path: resolveProjectArtifactPath(projectPath, 'scenePrompts', config),
      exists: existsSync(
        resolveProjectArtifactPath(projectPath, 'scenePrompts', config)
      )
    }
  ]

  return items
}

function collectMissingDirectories(
  projectPath: string,
  config: ProjectConfig
): string[] {
  const layout = resolveProjectLayout(config)
  const dirs = [
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
    layout.storyReviewsDir,
    layout.scriptReviewsDir,
    layout.storyboardReviewsDir,
    layout.exportsDir
  ]

  return dirs
    .map((dir) => assertPathWithinProject(projectPath, join(projectPath, dir)))
    .filter((dirPath) => !existsSync(dirPath))
}

function collectMissingTemplateFiles(
  projectPath: string,
  config: ProjectConfig
): string[] {
  const files: string[] = []
  const sourcePath = resolveProjectArtifactPath(
    projectPath,
    'sourceNovel',
    config
  )
  const storyBeatPath = resolveEpisodeArtifactPath(
    projectPath,
    'storyBeat',
    1,
    config
  )
  const plotBreakdownPath = resolveProjectArtifactPath(
    projectPath,
    'plotBreakdown',
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
    files.push(sourcePath)
  }

  if (config.entryStage === 'story' && !existsSync(storyBeatPath)) {
    files.push(storyBeatPath)
  }

  if (!existsSync(plotBreakdownPath)) {
    files.push(plotBreakdownPath)
  }

  if (config.entryStage === 'script' && !existsSync(scriptPath)) {
    files.push(scriptPath)
  }

  if (!existsSync(characterPromptsPath)) {
    files.push(characterPromptsPath)
  }

  if (!existsSync(scenePromptsPath)) {
    files.push(scenePromptsPath)
  }

  return files
}

function syncRegisteredProjectConfig(
  projectPath: string,
  config: ProjectConfig
): void {
  const now = new Date().toISOString()
  updateProjectRecordByPath({
    projectPath,
    name: config.projectName,
    visualStyle: config.visualStyle,
    targetMedium: config.targetMedium,
    totalEpisodes: config.totalEpisodes,
    configJson: JSON.stringify(config),
    updatedAt: now
  })
}

async function createMissingTemplates(
  projectPath: string,
  config: ProjectConfig
): Promise<void> {
  const writeTemplate = (path: string, content: string) =>
    atomicWriteFile(assertPathWithinProject(projectPath, path), content)
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
  const plotBreakdownPath = resolveProjectArtifactPath(
    projectPath,
    'plotBreakdown',
    config
  )

  if (!existsSync(plotBreakdownPath)) {
    await writeTemplate(
      plotBreakdownPath,
      buildDefaultPlotBreakdownTemplate({
        projectName: config.projectName,
        projectType: config.targetMedium || '待确定',
        totalEpisodes: config.totalEpisodes,
        chaptersPerEpisode: config.chaptersPerEpisode || 0
      })
    )
  }

  if (config.entryStage === 'novel') {
    const sourcePath = resolveProjectArtifactPath(
      projectPath,
      'sourceNovel',
      config
    )
    if (!existsSync(sourcePath)) {
      await writeTemplate(
        sourcePath,
        buildDefaultSourceTemplate(config.projectName)
      )
    }
  }

  if (config.entryStage === 'story') {
    const storyBeatPath = resolveEpisodeArtifactPath(
      projectPath,
      'storyBeat',
      1,
      config
    )
    if (!existsSync(storyBeatPath)) {
      await writeTemplate(storyBeatPath, buildDefaultStoryBeatTemplate(1))
    }
  }

  if (config.entryStage === 'script') {
    const scriptPath = resolveEpisodeArtifactPath(
      projectPath,
      'script',
      1,
      config
    )
    if (!existsSync(scriptPath)) {
      await writeTemplate(scriptPath, buildDefaultScriptTemplate(1))
    }
  }

  if (!existsSync(characterPromptsPath)) {
    await writeTemplate(
      characterPromptsPath,
      buildDefaultCharacterPromptsTemplate()
    )
  }

  if (!existsSync(scenePromptsPath)) {
    await writeTemplate(scenePromptsPath, buildDefaultScenePromptsTemplate())
  }
}

export async function repairProjectIssues(
  params: ProjectRepairIssueParams
): Promise<ProjectRepairResult> {
  const { projectPath, actionIds, dryRun = false } = params
  const detectedBefore = detectProjectDirectory(projectPath)
  const diskConfig = readDiskConfig(
    assertPathWithinProject(
      projectPath,
      resolveProjectArtifactPath(projectPath, 'projectConfig')
    )
  )
  const suggestedConfig = detectedBefore.suggestedConfig || {}
  let config = mergeProjectConfig(diskConfig, suggestedConfig)
  const appliedActions: ProjectRepairActionId[] = []
  const plannedChanges: string[] = []

  for (const actionId of actionIds) {
    if (actionId === 'apply_suggested_config') {
      plannedChanges.push(
        `更新或生成项目配置: ${resolveProjectArtifactPath(projectPath, 'projectConfig', config)}`
      )
      if (dryRun) continue
      config = mergeProjectConfig(diskConfig, suggestedConfig)
      await writeNormalizedConfig(projectPath, config)
      syncRegisteredProjectConfig(projectPath, config)
      appliedActions.push(actionId)
      continue
    }

    if (actionId === 'create_missing_directories') {
      const missingDirectories = collectMissingDirectories(projectPath, config)
      plannedChanges.push(
        ...(missingDirectories.length > 0
          ? missingDirectories.map((dirPath) => `创建目录: ${dirPath}`)
          : ['标准目录结构已齐备，无需创建'])
      )
      if (dryRun) continue
      createMissingDirectories(projectPath, config)
      appliedActions.push(actionId)
      continue
    }

    if (actionId === 'create_missing_templates') {
      const missingDirectories = collectMissingDirectories(projectPath, config)
      const missingFiles = collectMissingTemplateFiles(projectPath, config)
      plannedChanges.push(
        ...missingDirectories.map((dirPath) => `创建目录: ${dirPath}`),
        ...(missingFiles.length > 0
          ? missingFiles.map((filePath) => `生成模板: ${filePath}`)
          : ['入口模板与素材模板已齐备，无需生成'])
      )
      if (dryRun) continue
      createMissingDirectories(projectPath, config)
      await createMissingTemplates(projectPath, config)
      appliedActions.push(actionId)
      continue
    }

    if (actionId === 'migrate_legacy_novel') {
      plannedChanges.push(
        `迁移旧版小说目录: ${join(projectPath, 'novel')} -> ${resolveProjectArtifactPath(projectPath, 'sourceNovel', config)}`
      )
      if (dryRun) continue
      const result = await migrateLegacyNovelDirectory(projectPath, config)
      if (result.success) {
        appliedActions.push(actionId)
      }
    }
  }

  const detected = detectProjectDirectory(projectPath)
  return {
    success: true,
    appliedActions,
    message: dryRun
      ? `预览完成，计划执行 ${plannedChanges.length} 项变更`
      : appliedActions.length > 0
        ? `已执行 ${appliedActions.length} 项修复动作`
        : '没有可执行的修复动作',
    detected,
    dryRun,
    plannedChanges,
    readyItems: collectReadyItems(
      projectPath,
      mergeProjectConfig(config, detected.suggestedConfig)
    )
  }
}
