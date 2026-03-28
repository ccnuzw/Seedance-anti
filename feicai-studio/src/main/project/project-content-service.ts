import { existsSync } from 'fs'
import { mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import type {
  EpisodeOutline,
  EpisodeOutlineItem,
  NovelContentDocument,
  PlotBreakdown,
  ProjectConfig,
  ScriptVersionSummary
} from '@shared/types'
import { listArtifacts, writeArtifactJson, writeArtifactText } from './artifact-service'
import {
  getWritableScriptEpisodePath,
  resolveScriptEpisodePath
} from './script-file-utils'
import {
  readProjectConfig,
  saveProjectConfig
} from './project-config-store'

const NOVEL_CONTENT_FILE = join('novel', 'original-content.md')
const PLOT_BREAKDOWN_FILE = 'plot-breakdown.json'

function padEpisode(episodeNumber: number): string {
  return String(episodeNumber).padStart(2, '0')
}

function getNovelContentPath(projectPath: string): string {
  return join(projectPath, NOVEL_CONTENT_FILE)
}

function getPlotBreakdownPath(projectPath: string): string {
  return join(projectPath, PLOT_BREAKDOWN_FILE)
}

function normalizeEpisodeOutline(input: Partial<EpisodeOutline> & Pick<EpisodeOutline, 'episodeNumber'>): EpisodeOutline {
  const episodeNumber = Math.max(1, Math.floor(input.episodeNumber))
  const updatedAt = input.updatedAt || new Date().toISOString()
  const code = input.code || `ep${padEpisode(episodeNumber)}`
  const title = input.title || `第${episodeNumber}集`
  const summary = input.summary || ''
  const sourceChapters = Array.isArray(input.sourceChapters)
    ? input.sourceChapters
      .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
      .map((item) => Math.max(1, Math.floor(item)))
    : []
  const scenes = Array.isArray(input.scenes)
    ? input.scenes.map((scene, index) => ({
      id: scene?.id || `${code}-scene-${index + 1}`,
      title: scene?.title || `场景 ${index + 1}`,
      summary: scene?.summary || '',
      beats: Array.isArray(scene?.beats) ? scene.beats.filter((item): item is string => typeof item === 'string') : [],
      sourceChapters: Array.isArray(scene?.sourceChapters)
        ? scene.sourceChapters.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
        : []
    }))
    : []

  return {
    episodeNumber,
    code,
    title,
    logline: input.logline,
    summary,
    sourceChapters,
    scenes,
    status: input.status === 'reviewed' ? 'reviewed' : 'draft',
    updatedAt
  }
}

function outlineToConfigItem(outline: EpisodeOutline): EpisodeOutlineItem {
  return {
    episodeNumber: outline.episodeNumber,
    title: outline.title,
    summary: outline.summary
  }
}

async function readPlotBreakdown(projectPath: string, config?: ProjectConfig | null): Promise<PlotBreakdown> {
  const filePath = getPlotBreakdownPath(projectPath)
  const projectConfig = config || await readProjectConfig(projectPath)
  const base: PlotBreakdown = {
    title: projectConfig?.novelTitle || projectConfig?.projectName || '',
    genre: projectConfig?.novelGenre || '',
    outlines: [],
    updatedAt: new Date().toISOString()
  }

  if (!existsSync(filePath)) {
    if (Array.isArray(projectConfig?.episodeOutlines) && projectConfig.episodeOutlines.length > 0) {
      return {
        ...base,
        outlines: projectConfig.episodeOutlines.map((item) => normalizeEpisodeOutline(item))
      }
    }
    return base
  }

  try {
    const raw = JSON.parse(await readFile(filePath, 'utf-8')) as Partial<PlotBreakdown>
    const outlines = Array.isArray(raw.outlines) ? raw.outlines.map((item) => normalizeEpisodeOutline(item)) : []
    return {
      title: typeof raw.title === 'string' ? raw.title : base.title,
      genre: typeof raw.genre === 'string' ? raw.genre : base.genre,
      outlines: outlines.sort((a, b) => a.episodeNumber - b.episodeNumber),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt
    }
  } catch {
    return base
  }
}

async function persistPlotBreakdown(projectPath: string, breakdown: PlotBreakdown, projectConfig?: ProjectConfig | null): Promise<PlotBreakdown> {
  const next: PlotBreakdown = {
    title: breakdown.title,
    genre: breakdown.genre,
    updatedAt: new Date().toISOString(),
    outlines: [...breakdown.outlines].sort((a, b) => a.episodeNumber - b.episodeNumber)
  }
  const config = projectConfig || await readProjectConfig(projectPath)
  await writeArtifactJson({
    projectPath,
    kind: 'plot_breakdown',
    filePath: getPlotBreakdownPath(projectPath),
    content: next,
    label: '分集剧情大纲',
    createdBy: 'user',
    metadata: {
      outlineCount: next.outlines.length
    }
  })
  await saveProjectConfig(projectPath, {
    novelTitle: next.title || config?.novelTitle,
    novelGenre: next.genre || config?.novelGenre,
    originalContent: {
      ...(config?.originalContent || {}),
      title: next.title || config?.originalContent?.title,
      genre: next.genre || config?.originalContent?.genre
    },
    episodeOutlines: next.outlines.map(outlineToConfigItem)
  })
  return next
}

export async function readNovelContent(projectPath: string): Promise<NovelContentDocument | null> {
  const filePath = getNovelContentPath(projectPath)
  if (!existsSync(filePath)) return null
  const content = await readFile(filePath, 'utf-8')
  const config = await readProjectConfig(projectPath)
  const statsUpdatedAt = new Date().toISOString()
  return {
    projectPath,
    contentPath: filePath,
    content,
    title: config?.originalContent?.title || config?.novelTitle,
    genre: config?.originalContent?.genre || config?.novelGenre,
    sourcePath: config?.originalContent?.sourcePath,
    importedAt: config?.originalContent?.importedAt,
    updatedAt: statsUpdatedAt
  }
}

export async function saveNovelContent(input: {
  projectPath: string
  content: string
  title?: string
  genre?: string
  sourcePath?: string
}): Promise<NovelContentDocument> {
  const now = new Date().toISOString()
  const filePath = getNovelContentPath(input.projectPath)
  await mkdir(join(input.projectPath, 'novel'), { recursive: true })
  await writeArtifactText({
    projectPath: input.projectPath,
    kind: 'plot_breakdown',
    filePath,
    content: input.content,
    contentType: 'text/markdown',
    label: '原著正文',
    createdBy: 'user',
    metadata: {
      documentType: 'original_content'
    }
  })
  await saveProjectConfig(input.projectPath, {
    sourceType: 'novel',
    novelTitle: input.title,
    novelGenre: input.genre,
    originalContent: {
      title: input.title,
      genre: input.genre,
      sourcePath: input.sourcePath,
      contentPath: NOVEL_CONTENT_FILE,
      importedAt: now,
      contentFormat: 'text'
    }
  })

  return {
    projectPath: input.projectPath,
    contentPath: filePath,
    content: input.content,
    title: input.title,
    genre: input.genre,
    sourcePath: input.sourcePath,
    importedAt: now,
    updatedAt: now
  }
}

export async function listEpisodeOutlines(projectPath: string): Promise<EpisodeOutline[]> {
  const breakdown = await readPlotBreakdown(projectPath)
  return breakdown.outlines
}

export async function getEpisodeOutline(projectPath: string, episodeNumber: number): Promise<EpisodeOutline | null> {
  const outlines = await listEpisodeOutlines(projectPath)
  return outlines.find((item) => item.episodeNumber === episodeNumber) || null
}

export async function saveEpisodeOutline(input: {
  projectPath: string
  episodeNumber: number
  outline: Partial<EpisodeOutline>
}): Promise<EpisodeOutline> {
  const config = await readProjectConfig(input.projectPath)
  const breakdown = await readPlotBreakdown(input.projectPath, config)
  const nextOutline = normalizeEpisodeOutline({
    ...input.outline,
    episodeNumber: input.episodeNumber
  })

  const nextOutlines = breakdown.outlines.filter((item) => item.episodeNumber !== input.episodeNumber)
  nextOutlines.push(nextOutline)
  await persistPlotBreakdown(input.projectPath, {
    ...breakdown,
    outlines: nextOutlines
  }, config)

  return nextOutline
}

export async function deleteEpisodeOutline(projectPath: string, episodeNumber: number): Promise<{ success: true }> {
  const config = await readProjectConfig(projectPath)
  const breakdown = await readPlotBreakdown(projectPath, config)
  await persistPlotBreakdown(projectPath, {
    ...breakdown,
    outlines: breakdown.outlines.filter((item) => item.episodeNumber !== episodeNumber)
  }, config)
  return { success: true }
}

export async function generateEpisodeOutline(input: {
  projectPath: string
  episodeNumber: number
}): Promise<EpisodeOutline> {
  const existing = await getEpisodeOutline(input.projectPath, input.episodeNumber)
  if (existing) return existing

  const novel = await readNovelContent(input.projectPath)
  const summary = novel?.content.trim().slice(0, 300) || `请补充第${input.episodeNumber}集剧情摘要。`
  return saveEpisodeOutline({
    projectPath: input.projectPath,
    episodeNumber: input.episodeNumber,
    outline: {
      title: `第${input.episodeNumber}集`,
      summary,
      logline: `根据原著内容整理第${input.episodeNumber}集剧情。`,
      sourceChapters: input.episodeNumber === 1 ? [1] : [],
      scenes: [
        {
          id: `ep${padEpisode(input.episodeNumber)}-scene-1`,
          title: '开场',
          summary: summary.slice(0, 120) || '待补充场景描述',
          beats: [],
          sourceChapters: input.episodeNumber === 1 ? [1] : []
        }
      ]
    }
  })
}

function renderScriptMarkdown(outline: EpisodeOutline, existingContent?: string | null): string {
  if (existingContent && existingContent.trim().length > 0) {
    return existingContent
  }

  const scenes = outline.scenes.length > 0
    ? outline.scenes.map((scene, index) => [
      `## 场景 ${index + 1}：${scene.title}`,
      '',
      scene.summary || '待补充场景内容',
      scene.beats && scene.beats.length > 0 ? `\n- ${scene.beats.join('\n- ')}` : ''
    ].join('\n')).join('\n\n')
    : '## 场景 1\n\n待补充场景内容'

  return [
    `# ${outline.title} 剧本`,
    '',
    `> 集数：${outline.code.toUpperCase()}`,
    outline.logline ? `> Logline：${outline.logline}` : '',
    outline.sourceChapters.length > 0 ? `> 原著章节：${outline.sourceChapters.join(', ')}` : '',
    '',
    '## 剧情摘要',
    '',
    outline.summary || '待补充本集摘要',
    '',
    scenes,
    ''
  ].filter(Boolean).join('\n')
}

export async function generateEpisodeScript(input: {
  projectPath: string
  episodeNumber: number
  force?: boolean
}): Promise<{ success: true; content: string; filePath: string; outline: EpisodeOutline }> {
  const outline = await generateEpisodeOutline({
    projectPath: input.projectPath,
    episodeNumber: input.episodeNumber
  })
  const filePath = resolveScriptEpisodePath(input.projectPath, input.episodeNumber)
    || getWritableScriptEpisodePath(input.projectPath, input.episodeNumber)
  const existing = existsSync(filePath) ? await readFile(filePath, 'utf-8') : null
  const content = input.force ? renderScriptMarkdown(outline, null) : renderScriptMarkdown(outline, existing)
  await writeArtifactText({
    projectPath: input.projectPath,
    kind: 'script_episode',
    filePath,
    content,
    contentType: 'text/markdown',
    episodeNum: input.episodeNumber,
    createdBy: 'user',
    metadata: {
      generatedFromOutline: true,
      outlineUpdatedAt: outline.updatedAt
    }
  })

  return {
    success: true,
    content,
    filePath,
    outline
  }
}

export async function listScriptVersions(projectPath: string, episodeNumber: number): Promise<ScriptVersionSummary[]> {
  const artifacts = await listArtifacts({
    projectPath,
    kind: 'script_episode',
    episodeNum: episodeNumber,
    currentOnly: false
  })

  return artifacts.map((artifact) => ({
    artifactId: artifact.id,
    version: artifact.version,
    createdAt: artifact.createdAt,
    createdBy: artifact.createdBy,
    filePath: artifact.filePath,
    snapshotPath: artifact.snapshotPath,
    isCurrent: artifact.isCurrent
  }))
}
