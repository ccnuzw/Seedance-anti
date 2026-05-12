import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ProjectConfig } from '@shared/types'
import type {
  DetectedProjectInfo,
  ProjectIntegrityCheck,
  ProjectIntegrityGroup,
  ProjectIntegrityReport,
  ProjectRepairAction
} from '@shared/project-detection'
import { normalizeProjectConfig } from '@shared/project-config'
import {
  resolveProjectArtifactPath,
  resolveProjectLayout
} from '@shared/path-resolver'
import { scanProjectFilesystem } from '../project-sync/scan'

const CANDIDATE_CHILD_DIRS = ['小说', 'novel', 'project', '项目']

function hasEpisodeMarkdownFiles(dirPath: string): boolean {
  try {
    return readdirSync(dirPath).some((name) => /^ep\d+\.md$/i.test(name))
  } catch {
    return false
  }
}

function countMatchingFiles(dirPath: string, pattern: RegExp): number {
  try {
    return readdirSync(dirPath).filter((name) => pattern.test(name)).length
  } catch {
    return 0
  }
}

function detectScriptDir(projectPath: string, config: ProjectConfig): string {
  const currentScriptDir = config.directories?.scriptDir || 'script'
  const currentScriptPath = join(projectPath, currentScriptDir)
  const legacyScriptPath = join(projectPath, 'scripts')

  const currentHasEpisodes =
    existsSync(currentScriptPath) && hasEpisodeMarkdownFiles(currentScriptPath)
  const legacyHasEpisodes =
    existsSync(legacyScriptPath) && hasEpisodeMarkdownFiles(legacyScriptPath)

  if (legacyHasEpisodes && !currentHasEpisodes) {
    return 'scripts'
  }

  return currentScriptDir
}

function dedupeRepairActions(
  actions: ProjectRepairAction[]
): ProjectRepairAction[] {
  const seen = new Set<string>()
  const deduped: ProjectRepairAction[] = []

  for (const action of actions) {
    if (seen.has(action.id)) continue
    seen.add(action.id)
    deduped.push(action)
  }

  return deduped
}

function inferProjectConfig(
  projectPath: string,
  rawConfig: Partial<ProjectConfig> | null
): ProjectConfig {
  const normalized = normalizeProjectConfig(rawConfig)
  const scriptDir = detectScriptDir(projectPath, normalized)
  const configWithDetectedScriptDir: ProjectConfig = {
    ...normalized,
    directories: {
      ...normalized.directories,
      scriptDir
    }
  }
  const layout = resolveProjectLayout(configWithDetectedScriptDir)
  const scriptDirPath = join(projectPath, layout.scriptDir)
  const storyEpisodeDirPath = join(projectPath, layout.storyEpisodeBeatsDir)
  const hasSourceNovel = existsSync(
    resolveProjectArtifactPath(projectPath, 'sourceNovel', normalized)
  )
  const hasScriptEpisodes =
    existsSync(scriptDirPath) && hasEpisodeMarkdownFiles(scriptDirPath)
  const hasStoryEpisodes =
    existsSync(storyEpisodeDirPath) &&
    hasEpisodeMarkdownFiles(storyEpisodeDirPath)

  const entryStage =
    !hasSourceNovel && hasScriptEpisodes
      ? 'script'
      : !hasSourceNovel && hasStoryEpisodes
        ? 'story'
        : normalized.entryStage

  const workflowMode =
    entryStage === 'script'
      ? 'script_to_shortdrama'
      : entryStage === 'story'
        ? 'story_to_shortdrama'
        : 'novel_to_shortdrama'

  return {
    ...normalized,
    entryStage,
    workflowMode,
    directories: {
      ...normalized.directories,
      scriptDir
    }
  }
}

function buildIntegrityReport(
  projectPath: string,
  configPath: string | null,
  rawConfig: string | null,
  effectiveConfig: ProjectConfig
): ProjectIntegrityReport {
  const configRecommendedActions: ProjectRepairAction[] = []
  let configStatus: ProjectIntegrityCheck['status'] = 'warn'
  let configDetail = '未找到 project-config.json'

  if (configPath && rawConfig) {
    try {
      JSON.parse(rawConfig)
      configStatus = 'pass'
      configDetail = '已找到并解析 project-config.json'
    } catch {
      configStatus = 'fail'
      configDetail = 'project-config.json 存在，但内容无法解析'
      configRecommendedActions.push({
        id: 'apply_suggested_config',
        label: '重建项目配置',
        description: '根据当前目录结构重新生成标准配置'
      })
    }
  } else if (configPath) {
    configStatus = 'fail'
    configDetail = 'project-config.json 存在，但无法读取'
    configRecommendedActions.push({
      id: 'apply_suggested_config',
      label: '重建项目配置',
      description: '根据当前目录结构重新生成标准配置'
    })
  } else {
    configRecommendedActions.push({
      id: 'apply_suggested_config',
      label: '生成项目配置',
      description: '补齐标准 project-config.json'
    })
  }

  const scan = scanProjectFilesystem(
    projectPath,
    effectiveConfig,
    effectiveConfig.totalEpisodes || 0
  )

  const layout = resolveProjectLayout(effectiveConfig)
  const sourceNovelPath = resolveProjectArtifactPath(
    projectPath,
    'sourceNovel',
    effectiveConfig
  )
  const plotBreakdownPath = resolveProjectArtifactPath(
    projectPath,
    'plotBreakdown',
    effectiveConfig
  )
  const storyEpisodeDir = join(projectPath, layout.storyEpisodeBeatsDir)
  const scriptDir = join(projectPath, layout.scriptDir)
  const outputsDir = join(projectPath, layout.outputsDir)
  const reviewsDir = join(projectPath, layout.reviewsDir)
  const legacyStoryBreakdown = join(projectPath, 'plot-breakdown.md')
  const legacyScriptReview = join(projectPath, 'scripts', 'review-ep04-10.md')
  const legacyNovelDir = join(projectPath, 'novel')
  const legacyNovelCount = countMatchingFiles(
    legacyNovelDir,
    /^chapter-\d+\.(txt|md)$/i
  )
  const isLegacyScriptLayout =
    (effectiveConfig.directories?.scriptDir || 'script') === 'scripts'
  const sourceGroup: ProjectIntegrityGroup =
    legacyNovelCount > 0 ? 'legacy' : 'content'
  const storyGroup: ProjectIntegrityGroup =
    !existsSync(storyEpisodeDir) && existsSync(legacyStoryBreakdown)
      ? 'legacy'
      : 'directories'
  const scriptGroup: ProjectIntegrityGroup = isLegacyScriptLayout
    ? 'legacy'
    : 'directories'
  const reviewsGroup: ProjectIntegrityGroup =
    !existsSync(reviewsDir) && existsSync(legacyScriptReview)
      ? 'legacy'
      : 'directories'

  const checks: ProjectIntegrityCheck[] = [
    {
      id: 'config',
      group: 'config',
      label: '项目配置',
      status: configStatus,
      detail: configDetail,
      path: configPath,
      repairActions:
        configStatus !== 'pass'
          ? [
              {
                id: 'apply_suggested_config',
                label: configPath ? '修复项目配置' : '生成项目配置'
              }
            ]
          : undefined
    },
    {
      id: 'source_novel',
      group: sourceGroup,
      label: '小说原文',
      status: scan.hasSourceNovel ? 'pass' : 'warn',
      detail: scan.hasSourceNovel
        ? '已找到小说原文'
        : legacyNovelCount > 0
          ? `发现旧版小说目录 novel/，共 ${legacyNovelCount} 个章节文件`
          : '未找到小说原文，若从小说起步建议补齐',
      path: scan.hasSourceNovel
        ? sourceNovelPath
        : legacyNovelCount > 0
          ? legacyNovelDir
          : null,
      repairActions: scan.hasSourceNovel
        ? undefined
        : legacyNovelCount > 0
          ? [{ id: 'migrate_legacy_novel', label: '迁移旧版小说目录' }]
          : [{ id: 'create_missing_templates', label: '生成小说原文模板' }]
    },
    {
      id: 'plot_breakdown',
      group: existsSync(legacyStoryBreakdown) && !existsSync(plotBreakdownPath)
        ? 'legacy'
        : 'content',
      label: '剧情库存',
      status: existsSync(plotBreakdownPath) || existsSync(legacyStoryBreakdown)
        ? 'pass'
        : 'warn',
      detail: existsSync(plotBreakdownPath)
        ? '已找到剧情库存 story/plot-breakdown.md'
        : existsSync(legacyStoryBreakdown)
          ? '发现旧版剧情库存 plot-breakdown.md'
          : '未找到剧情库存，建议创建后再进行批次拆解',
      path: existsSync(plotBreakdownPath)
        ? plotBreakdownPath
        : existsSync(legacyStoryBreakdown)
          ? legacyStoryBreakdown
          : null,
      repairActions:
        existsSync(plotBreakdownPath) || existsSync(legacyStoryBreakdown)
          ? undefined
          : [{ id: 'create_missing_templates', label: '生成剧情库存模板' }]
    },
    {
      id: 'story_beats',
      group: storyGroup,
      label: '剧情拆解',
      status: existsSync(storyEpisodeDir) ? 'pass' : 'warn',
      detail: existsSync(storyEpisodeDir)
        ? '已找到剧情拆解目录'
        : existsSync(legacyStoryBreakdown)
          ? '发现旧版剧情拆解 plot-breakdown.md'
          : '未找到剧情拆解目录',
      path: existsSync(storyEpisodeDir)
        ? storyEpisodeDir
        : existsSync(legacyStoryBreakdown)
          ? legacyStoryBreakdown
          : null,
      repairActions: existsSync(storyEpisodeDir)
        ? undefined
        : [{ id: 'create_missing_directories', label: '创建剧情目录' }]
    },
    {
      id: 'script_dir',
      group: scriptGroup,
      label: '剧本目录',
      status: existsSync(scriptDir) ? 'pass' : 'warn',
      detail: existsSync(scriptDir)
        ? `已找到剧本目录 ${layout.scriptDir}`
        : '未找到剧本目录',
      path: scriptDir,
      repairActions: existsSync(scriptDir)
        ? undefined
        : [
            { id: 'apply_suggested_config', label: '应用目录推断' },
            { id: 'create_missing_directories', label: '创建剧本目录' }
          ]
    },
    {
      id: 'outputs_dir',
      group: 'directories',
      label: '输出目录',
      status: existsSync(outputsDir) ? 'pass' : 'warn',
      detail: existsSync(outputsDir) ? '已找到输出目录' : '未找到输出目录',
      path: outputsDir,
      repairActions: existsSync(outputsDir)
        ? undefined
        : [{ id: 'create_missing_directories', label: '创建输出目录' }]
    },
    {
      id: 'reviews_dir',
      group: reviewsGroup,
      label: '审核目录',
      status: existsSync(reviewsDir) ? 'pass' : 'warn',
      detail: existsSync(reviewsDir)
        ? '已找到审核目录'
        : existsSync(legacyScriptReview)
          ? '发现旧版剧本审核文件 scripts/review-ep04-10.md'
          : '未找到审核目录',
      path: existsSync(reviewsDir)
        ? reviewsDir
        : existsSync(legacyScriptReview)
          ? legacyScriptReview
          : null,
      repairActions: existsSync(reviewsDir)
        ? undefined
        : [{ id: 'create_missing_directories', label: '创建审核目录' }]
    },
    {
      id: 'episodes',
      group: 'content',
      label: '已识别集数',
      status: scan.episodeNumbers.length > 0 ? 'pass' : 'warn',
      detail:
        scan.episodeNumbers.length > 0
          ? `已识别 ${scan.episodeNumbers.length} 集`
          : '未识别到任何集数文件'
    }
  ]

  if (effectiveConfig.totalEpisodes > 0) {
    checks.push({
      id: 'coverage',
      group: 'content',
      label: '集数覆盖',
      status:
        scan.episodeNumbers.length >= effectiveConfig.totalEpisodes
          ? 'pass'
          : 'warn',
      detail: `已识别 ${scan.episodeNumbers.length}/${effectiveConfig.totalEpisodes} 集`
    })
  }

  const summary = checks.some((check) => check.status === 'fail')
    ? '存在关键问题，建议先修正后再导入'
    : checks.some((check) => check.status === 'warn')
      ? '项目可导入，但存在缺失项'
      : '项目结构完整'

  const status: ProjectIntegrityReport['status'] = checks.some(
    (check) => check.status === 'fail'
  )
    ? 'fail'
    : checks.some((check) => check.status === 'warn')
      ? 'warn'
      : 'pass'

  const recommendedActions = dedupeRepairActions([
    ...configRecommendedActions,
    ...checks.flatMap((check) => check.repairActions || [])
  ])

  return {
    status,
    summary,
    detectedEpisodes: scan.episodeNumbers.length,
    expectedEpisodes:
      effectiveConfig.totalEpisodes > 0 ? effectiveConfig.totalEpisodes : null,
    checks,
    recommendedActions:
      recommendedActions.length > 0 ? recommendedActions : undefined
  }
}

function inspectDir(dirPath: string): DetectedProjectInfo {
  const layout = resolveProjectLayout()
  const configPath = resolveProjectArtifactPath(dirPath, 'projectConfig')
  const outputsDir = join(dirPath, layout.outputsDir)
  let rawConfig: string | null = null
  let parsedConfig: Partial<ProjectConfig> | null = null

  if (existsSync(configPath)) {
    try {
      rawConfig = readFileSync(configPath, 'utf-8')
      parsedConfig = JSON.parse(rawConfig) as Partial<ProjectConfig>
    } catch {
      rawConfig = null
    }
  }

  const effectiveConfig = inferProjectConfig(dirPath, parsedConfig)
  const integrity = buildIntegrityReport(
    dirPath,
    existsSync(configPath) ? configPath : null,
    rawConfig,
    effectiveConfig
  )

  return {
    resolvedPath: dirPath,
    configPath: existsSync(configPath) ? configPath : null,
    scriptDir: existsSync(
      join(dirPath, effectiveConfig.directories?.scriptDir || layout.scriptDir)
    )
      ? join(
          dirPath,
          effectiveConfig.directories?.scriptDir || layout.scriptDir
        )
      : null,
    outputsDir: existsSync(outputsDir) ? outputsDir : null,
    integrity,
    suggestedConfig: effectiveConfig
  }
}

function getDirScore(info: DetectedProjectInfo): number {
  let score = 0
  if (info.configPath) score += 10
  if (info.scriptDir) score += 4
  if (info.outputsDir) score += 4
  return score
}

export function detectProjectDirectory(
  selectedPath: string
): DetectedProjectInfo {
  const directInfo = inspectDir(selectedPath)
  const directScore = getDirScore(directInfo)

  let bestInfo = directInfo
  let bestScore = directScore

  for (const childName of CANDIDATE_CHILD_DIRS) {
    const childPath = join(selectedPath, childName)
    if (!existsSync(childPath)) continue
    const childInfo = inspectDir(childPath)
    const childScore = getDirScore(childInfo)
    if (childScore > bestScore) {
      bestInfo = { ...childInfo, nestedProjectDirName: childName }
      bestScore = childScore
    }
  }

  if (bestScore > directScore) return bestInfo

  // 兜底：如果显式候选目录没有命中，再扫描一级子目录里的标准项目结构
  try {
    for (const entry of readdirSync(selectedPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const childPath = join(selectedPath, entry.name)
      const childInfo = inspectDir(childPath)
      const childScore = getDirScore(childInfo)
      if (childScore > bestScore && childInfo.configPath) {
        bestInfo = { ...childInfo, nestedProjectDirName: entry.name }
        bestScore = childScore
      }
    }
  } catch {
    // ignore unreadable directories
  }

  return bestInfo
}
