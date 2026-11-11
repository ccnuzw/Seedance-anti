import { existsSync, readFileSync } from 'fs'
import { atomicWriteFileSync } from '../io/atomic-file'
import {
  assertEpisodeNumber,
  assertPathWithinProject
} from '../security/access-control'
import { buildDefaultPlotBreakdownTemplate } from '@shared/project-bootstrap'
import type { ProjectConfig } from '@shared/types'
import {
  appendPlotBreakdownBatch,
  validateGeneratedPlotBreakdown,
  formatPlotBreakdownEntriesMarkdown,
  getPlotBreakdownEntriesForEpisode,
  parsePlotBreakdownMarkdown,
  serializePlotBreakdownMarkdown,
  summarizePlotBreakdownWaterline,
  updatePlotBreakdownEntryStatus,
  type PlotBreakdownDocument,
  type PlotBreakdownEntry,
  type PlotBreakdownEntryStatus
} from '@shared/plot-breakdown'
import { resolveProjectArtifactPath } from '@shared/path-resolver'
import { listSourceChapters } from './novel-importer'

export interface PlotBreakdownSummary {
  totalEntries: number
  usedEntries: number
  unusedEntries: number
  totalBatches: number
  readyEpisodeCount: number
  readyEpisodeNumbers: number[]
  usedEpisodeCount: number
  usedEpisodeNumbers: number[]
  chapterStart: number | null
  chapterEnd: number | null
  nextBatchNumber: number
  targetChapterLimit: number | null
  totalSourceChapters: number
  unprocessedChapterCount: number | null
  overflowChapterCount: number
  waterlineStatus: 'ready' | 'low' | 'empty' | 'done'
  nextActionLabel: string
  nextActionMode: 'script' | 'breakdown' | 'done'
  breakdownProgressPct: number
  scriptProgressPct: number
  remainingBatchCount: number
  nextChapterStart: number | null
  nextChapterEnd: number | null
  path: string
  exists: boolean
}

export interface AppendPlotBreakdownBatchResult {
  path: string
  appendedEntries: number
}

export function getPlotBreakdownPath(params: {
  projectPath: string
  config?: Partial<ProjectConfig> | null
}): string {
  return assertPathWithinProject(
    params.projectPath,
    resolveProjectArtifactPath(
      params.projectPath,
      'plotBreakdown',
      params.config
    )
  )
}

export function ensurePlotBreakdownFile(params: {
  projectPath: string
  config: ProjectConfig
}): string {
  const filePath = getPlotBreakdownPath(params)
  if (!existsSync(filePath)) {
    atomicWriteFileSync(
      filePath,
      buildDefaultPlotBreakdownTemplate({
        projectName: params.config.projectName,
        projectType: params.config.targetMedium || '待确定',
        totalEpisodes: params.config.totalEpisodes,
        chaptersPerEpisode: params.config.chaptersPerEpisode || 0
      })
    )
  }
  return filePath
}

export function readPlotBreakdown(params: {
  projectPath: string
  config: ProjectConfig
}): { path: string; raw: string; document: PlotBreakdownDocument } {
  const filePath = ensurePlotBreakdownFile(params)
  const raw = readFileSync(filePath, 'utf-8')
  return {
    path: filePath,
    raw,
    document: parsePlotBreakdownMarkdown(raw)
  }
}

export function writePlotBreakdown(params: {
  projectPath: string
  config: ProjectConfig
  document: PlotBreakdownDocument
}): string {
  const filePath = getPlotBreakdownPath(params)
  atomicWriteFileSync(filePath, serializePlotBreakdownMarkdown(params.document))
  return filePath
}

export function summarizeProjectPlotBreakdown(params: {
  projectPath: string
  config: ProjectConfig
}): PlotBreakdownSummary {
  const filePath = getPlotBreakdownPath(params)
  const chapters = listSourceChapters({
    projectPath: params.projectPath,
    config: params.config,
    readOnly: true
  })
  const totalSourceChapters = chapters.length
  const chaptersPerEpisode = Math.max(
    0,
    Number(params.config.chaptersPerEpisode) || 0
  )
  const totalEpisodes = Math.max(0, Number(params.config.totalEpisodes) || 0)
  const targetChapterLimit =
    totalEpisodes > 0 && chaptersPerEpisode > 0
      ? totalEpisodes * chaptersPerEpisode
      : null
  const scopedSourceChapterCount = targetChapterLimit
    ? chapters.filter((chapter) => chapter.index <= targetChapterLimit).length
    : totalSourceChapters
  const overflowChapterCount = targetChapterLimit
    ? chapters.filter((chapter) => chapter.index > targetChapterLimit).length
    : 0
  const emptySummary = buildPlotBreakdownSummary({
    path: filePath,
    exists: false,
    base: {
      totalEntries: 0,
      usedEntries: 0,
      unusedEntries: 0,
      totalBatches: 0,
      readyEpisodeCount: 0,
      readyEpisodeNumbers: [],
      usedEpisodeCount: 0,
      usedEpisodeNumbers: [],
      chapterStart: null,
      chapterEnd: null,
      nextBatchNumber: 1
    },
    targetChapterLimit,
    totalSourceChapters,
    scopedSourceChapterCount,
    overflowChapterCount
  })

  if (!existsSync(filePath)) {
    return emptySummary
  }

  const raw = readFileSync(filePath, 'utf-8')
  return buildPlotBreakdownSummary({
    path: filePath,
    exists: true,
    base: summarizePlotBreakdownWaterline(parsePlotBreakdownMarkdown(raw)),
    targetChapterLimit,
    totalSourceChapters,
    scopedSourceChapterCount,
    overflowChapterCount
  })
}

function buildPlotBreakdownSummary(params: {
  path: string
  exists: boolean
  base: Omit<
    PlotBreakdownSummary,
    | 'path'
    | 'exists'
    | 'targetChapterLimit'
    | 'totalSourceChapters'
    | 'unprocessedChapterCount'
    | 'overflowChapterCount'
    | 'waterlineStatus'
    | 'nextActionLabel'
    | 'nextActionMode'
    | 'breakdownProgressPct'
    | 'scriptProgressPct'
    | 'remainingBatchCount'
    | 'nextChapterStart'
    | 'nextChapterEnd'
  >
  targetChapterLimit: number | null
  totalSourceChapters: number
  scopedSourceChapterCount: number
  overflowChapterCount: number
}): PlotBreakdownSummary {
  const processedChapterCount =
    params.base.chapterEnd != null
      ? Math.min(params.base.chapterEnd, params.scopedSourceChapterCount)
      : 0
  const unprocessedChapterCount =
    params.scopedSourceChapterCount > 0
      ? Math.max(0, params.scopedSourceChapterCount - processedChapterCount)
      : null
  const hasUnprocessedChapters =
    unprocessedChapterCount == null ? false : unprocessedChapterCount > 0
  const targetCount = Math.max(0, params.scopedSourceChapterCount)
  const breakdownProgressPct =
    targetCount > 0
      ? Math.min(100, Math.round((processedChapterCount / targetCount) * 100))
      : params.exists
        ? 100
        : 0
  const knownScriptEpisodes =
    params.base.readyEpisodeCount + params.base.usedEpisodeCount
  const scriptProgressPct =
    knownScriptEpisodes > 0
      ? Math.round((params.base.usedEpisodeCount / knownScriptEpisodes) * 100)
      : 0
  const remainingBatchCount =
    unprocessedChapterCount && unprocessedChapterCount > 0
      ? Math.ceil(unprocessedChapterCount / 6)
      : 0
  const nextChapterStart = hasUnprocessedChapters
    ? processedChapterCount + 1
    : null
  const nextChapterEnd =
    nextChapterStart && targetCount > 0
      ? Math.min(nextChapterStart + 5, targetCount)
      : null
  const hasEnoughUnusedEntries = params.base.unusedEntries >= 6
  const hasAnyUnusedEntries = params.base.unusedEntries > 0
  const waterlineStatus = hasEnoughUnusedEntries
    ? 'ready'
    : hasAnyUnusedEntries
      ? 'low'
      : hasUnprocessedChapters
        ? 'empty'
        : 'done'
  const nextActionMode = hasEnoughUnusedEntries
    ? 'script'
    : hasUnprocessedChapters
      ? 'breakdown'
      : hasAnyUnusedEntries
        ? 'script'
        : 'done'
  const nextActionLabel =
    nextActionMode === 'script'
      ? hasEnoughUnusedEntries
        ? '未用剧情点充足，建议继续生成剧本'
        : '最后的剧情储备，建议生成剧本'
      : nextActionMode === 'breakdown'
        ? hasAnyUnusedEntries
          ? '未用剧情点不足 6 条，建议先补剧情拆解'
          : '无可用剧情点，需要先拆解小说章节'
        : '目标范围内的剧情拆解与剧本库存已完成'

  return {
    ...params.base,
    path: params.path,
    exists: params.exists,
    targetChapterLimit: params.targetChapterLimit,
    totalSourceChapters: params.totalSourceChapters,
    unprocessedChapterCount,
    overflowChapterCount: params.overflowChapterCount,
    waterlineStatus,
    nextActionLabel,
    nextActionMode,
    breakdownProgressPct,
    scriptProgressPct,
    remainingBatchCount,
    nextChapterStart,
    nextChapterEnd
  }
}

export function getProjectPlotBreakdownEntriesForEpisode(params: {
  projectPath: string
  config: ProjectConfig
  episodeNum: number
  status?: PlotBreakdownEntryStatus
}): PlotBreakdownEntry[] {
  assertEpisodeNumber(params.episodeNum)
  const { document } = readPlotBreakdown(params)
  return getPlotBreakdownEntriesForEpisode(document, params.episodeNum, {
    status: params.status
  })
}

export function getProjectPlotBreakdownMarkdownForEpisode(params: {
  projectPath: string
  config: ProjectConfig
  episodeNum: number
  status?: PlotBreakdownEntryStatus
  heading?: string
}): string {
  const entries = getProjectPlotBreakdownEntriesForEpisode(params)
  if (entries.length === 0) return ''
  return formatPlotBreakdownEntriesMarkdown(entries, {
    heading: params.heading
  })
}

export function appendGeneratedStoryToProjectPlotBreakdown(params: {
  projectPath: string
  config: ProjectConfig
  generatedContent: string
  batchNumber: number
  chaptersPerBatch?: number
}): AppendPlotBreakdownBatchResult {
  assertEpisodeNumber(params.batchNumber)
  const entries = validateGeneratedPlotBreakdown(
    params.generatedContent,
    params.config.totalEpisodes
  )
  const filePath = ensurePlotBreakdownFile(params)
  const doc = parsePlotBreakdownMarkdown(readFileSync(filePath, 'utf-8'))
  const chaptersPerBatch = params.chaptersPerBatch ?? 6
  if (!Number.isSafeInteger(chaptersPerBatch) || chaptersPerBatch <= 0)
    throw new Error('每批章节数无效')
  const chapterStart = (params.batchNumber - 1) * chaptersPerBatch + 1
  const sourceChapters = listSourceChapters(params)
  const configuredLimit =
    params.config.totalEpisodes > 0 &&
    (params.config.chaptersPerEpisode || 0) > 0
      ? params.config.totalEpisodes * params.config.chaptersPerEpisode!
      : Infinity
  const sourceLimit =
    sourceChapters.length > 0
      ? Math.max(...sourceChapters.map((chapter) => chapter.index))
      : Infinity
  const chapterEnd = Math.min(
    chapterStart + chaptersPerBatch - 1,
    configuredLimit,
    sourceLimit
  )
  if (chapterEnd < chapterStart) throw new Error('当前剧情批次超出小说章节范围')
  const heading = `### 第${params.batchNumber}批（第${chapterStart}-${chapterEnd}章）`
  const result = appendPlotBreakdownBatch(doc, {
    heading,
    entries,
    chapterStart,
    chapterEnd,
    replaceExistingHeading: true
  })
  if (result.appendedEntries === 0) throw new Error('剧情库存未写入任何剧情点')
  const stableBatches = (document: PlotBreakdownDocument) =>
    JSON.stringify(
      document.batches.map((batch) => ({
        ...batch,
        entries: batch.entries.map(
          ({ id, index, content, episode, status }) => ({
            id,
            index,
            content,
            episode,
            status
          })
        )
      }))
    )
  // Re-reviewing the same batch must not rewrite the inventory (including its
  // human planning notes); preserve stable identities and consumption status.
  if (stableBatches(doc) !== stableBatches(result.document))
    atomicWriteFileSync(
      filePath,
      serializePlotBreakdownMarkdown(result.document)
    )

  return {
    path: filePath,
    appendedEntries: result.appendedEntries
  }
}

export function markProjectPlotBreakdownEpisodeStatus(params: {
  projectPath: string
  config: ProjectConfig
  episodeNum: number
  fromStatus?: PlotBreakdownEntryStatus
  toStatus: PlotBreakdownEntryStatus
}): {
  path: string
  updatedEntries: number
} {
  assertEpisodeNumber(params.episodeNum)
  const filePath = ensurePlotBreakdownFile(params)
  const raw = readFileSync(filePath, 'utf-8')
  const doc = parsePlotBreakdownMarkdown(raw)
  let updatedEntries = 0

  for (const batch of doc.batches) {
    for (const entry of batch.entries) {
      if (entry.episode !== params.episodeNum) continue
      if (params.fromStatus && entry.status !== params.fromStatus) continue
      if (entry.status === params.toStatus) continue
      entry.status = params.toStatus
      updatedEntries += 1
    }
  }

  if (updatedEntries > 0) {
    atomicWriteFileSync(filePath, serializePlotBreakdownMarkdown(doc))
  }

  return {
    path: filePath,
    updatedEntries
  }
}

export function updateProjectPlotBreakdownEntryStatus(params: {
  projectPath: string
  config: ProjectConfig
  entryIndex: number
  status: PlotBreakdownEntryStatus
}): { path: string; updated: boolean } {
  const filePath = ensurePlotBreakdownFile(params)
  const raw = readFileSync(filePath, 'utf-8')
  const result = updatePlotBreakdownEntryStatus(
    raw,
    params.entryIndex,
    params.status
  )
  if (result.updated) {
    atomicWriteFileSync(filePath, result.content)
  }
  return {
    path: filePath,
    updated: result.updated
  }
}
