export type PlotBreakdownEntryStatus = '未用' | '已用'

export interface PlotBreakdownEntry {
  index: number
  content: string
  episode: number | null
  status: PlotBreakdownEntryStatus
  rawLine: string
}

export interface PlotBreakdownBatch {
  heading: string
  chapterStart: number | null
  chapterEnd: number | null
  entries: PlotBreakdownEntry[]
}

export interface PlotBreakdownDocument {
  projectName: string | null
  projectType: string | null
  range: string | null
  targetEpisodes: string | null
  chaptersPerEpisode: string | null
  planningLines: string[]
  batches: PlotBreakdownBatch[]
  trailingLines: string[]
}

export interface PlotBreakdownEpisodeEntries {
  episode: number
  entries: PlotBreakdownEntry[]
}

export interface PlotBreakdownWaterlineSummary {
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
}

function normalizeMarkdownText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function parseBatchHeading(line: string): {
  heading: string
  chapterStart: number | null
  chapterEnd: number | null
} | null {
  const match = line.match(
    /^###\s+(?:(?:第\d+批)[（(])?第(\d+)-(\d+)章[）)]?/u
  )
  if (!match) return null
  const chapterStart = Number(match[1])
  const chapterEnd = Number(match[2])
  return {
    heading: line.trim(),
    chapterStart: Number.isFinite(chapterStart) ? chapterStart : null,
    chapterEnd: Number.isFinite(chapterEnd) ? chapterEnd : null
  }
}

export function parsePlotBreakdownEntryLine(
  line: string
): PlotBreakdownEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('【剧情')) return null

  const match = trimmed.match(
    /^【剧情(\d+)】(.*?)(?:，第(\d+)集)?(?:，状态：(未用|已用))?$/
  )
  if (!match) return null

  const index = Number(match[1])
  const content = match[2].trim()
  const episode = match[3] ? Number(match[3]) : null
  const status = (match[4] as PlotBreakdownEntryStatus | undefined) || '未用'

  return {
    index: Number.isFinite(index) ? index : 0,
    content,
    episode: Number.isFinite(episode || NaN) ? episode : null,
    status,
    rawLine: trimmed
  }
}

export function extractPlotBreakdownEntries(raw: string): PlotBreakdownEntry[] {
  return normalizeMarkdownText(raw)
    .split('\n')
    .map((line) => parsePlotBreakdownEntryLine(line))
    .filter((entry): entry is PlotBreakdownEntry => Boolean(entry))
}

export function parsePlotBreakdownMarkdown(
  raw: string
): PlotBreakdownDocument {
  const lines = normalizeMarkdownText(raw).split('\n')
  const planningLines: string[] = []
  const trailingLines: string[] = []
  const batches: PlotBreakdownBatch[] = []

  let projectName: string | null = null
  let projectType: string | null = null
  let range: string | null = null
  let targetEpisodes: string | null = null
  let chaptersPerEpisode: string | null = null
  let section: 'intro' | 'planning' | 'list' | 'trailing' = 'intro'
  let currentBatch: PlotBreakdownBatch | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    const nameMatch = trimmed.match(/^\*\*小说名称\*\*：?《(.+?)》$/u)
    if (nameMatch) {
      projectName = nameMatch[1]
    }
    const typeMatch = trimmed.match(/^\*\*小说类型\*\*：(.+)$/u)
    if (typeMatch) {
      projectType = typeMatch[1].trim()
    }
    const rangeMatch = trimmed.match(/^- \*\*范围\*\*：(.+)$/u)
    if (rangeMatch) {
      range = rangeMatch[1].trim()
    }
    const targetMatch = trimmed.match(/^- \*\*目标集数\*\*：(.+)$/u)
    if (targetMatch) {
      targetEpisodes = targetMatch[1].trim()
    }
    const chaptersMatch = trimmed.match(/^- \*\*章节-集数分配原则\*\*：(.+)$/u)
    if (chaptersMatch) {
      chaptersPerEpisode = chaptersMatch[1].trim()
    }

    if (/^##\s+改编规划/.test(trimmed)) {
      section = 'planning'
      continue
    }
    if (/^##\s+剧情列表/.test(trimmed)) {
      section = 'list'
      continue
    }

    if (section === 'planning') {
      if (trimmed) planningLines.push(line)
      continue
    }

    if (section === 'list') {
      const batchHeading = parseBatchHeading(line)
      if (batchHeading) {
        currentBatch = {
          ...batchHeading,
          entries: []
        }
        batches.push(currentBatch)
        continue
      }

      const entry = parsePlotBreakdownEntryLine(line)
      if (entry) {
        if (!currentBatch) {
          currentBatch = {
            heading: '### 未分组剧情',
            chapterStart: null,
            chapterEnd: null,
            entries: []
          }
          batches.push(currentBatch)
        }
        currentBatch.entries.push(entry)
        continue
      }

      if (trimmed) {
        trailingLines.push(line)
      }
      continue
    }
  }

  return {
    projectName,
    projectType,
    range,
    targetEpisodes,
    chaptersPerEpisode,
    planningLines,
    batches,
    trailingLines
  }
}

export function serializePlotBreakdownMarkdown(
  doc: PlotBreakdownDocument
): string {
  const parts: string[] = ['# 剧情拆解']

  if (doc.projectName) {
    parts.push('', `**小说名称**：《${doc.projectName}》`)
  }
  if (doc.projectType) {
    parts.push(`**小说类型**：${doc.projectType}`)
  }

  parts.push('', '---', '', '## 改编规划')

  if (doc.range) parts.push(`- **范围**：${doc.range}`)
  if (doc.targetEpisodes) parts.push(`- **目标集数**：${doc.targetEpisodes}`)
  if (doc.chaptersPerEpisode) {
    parts.push(`- **章节-集数分配原则**：${doc.chaptersPerEpisode}`)
  }

  if (doc.planningLines.length > 0) {
    parts.push(...doc.planningLines.map((line) => line.trimEnd()))
  }

  parts.push('', '## 剧情列表', '')

  for (const batch of doc.batches) {
    parts.push(batch.heading)
    parts.push('')
    for (const entry of batch.entries) {
      parts.push(formatPlotBreakdownEntry(entry))
    }
    parts.push('')
  }

  if (doc.trailingLines.length > 0) {
    parts.push(...doc.trailingLines.map((line) => line.trimEnd()))
  }

  return `${parts.join('\n').trim()}\n`
}

export function updatePlotBreakdownPlanning(
  raw: string,
  params: {
    projectName?: string
    projectType?: string
    totalEpisodes?: number
    chaptersPerEpisode?: number
  }
): string {
  const doc = parsePlotBreakdownMarkdown(raw)
  const totalEpisodes = Math.max(0, Number(params.totalEpisodes) || 0)
  const chaptersPerEpisode = Math.max(0, Number(params.chaptersPerEpisode) || 0)
  const targetChapterLimit =
    totalEpisodes > 0 && chaptersPerEpisode > 0
      ? totalEpisodes * chaptersPerEpisode
      : 0

  return serializePlotBreakdownMarkdown({
    ...doc,
    projectName: params.projectName?.trim() || doc.projectName,
    projectType: params.projectType?.trim() || doc.projectType,
    range: targetChapterLimit > 0 ? `第1-${targetChapterLimit}章` : doc.range,
    targetEpisodes: totalEpisodes > 0 ? `${totalEpisodes} 集` : doc.targetEpisodes,
    chaptersPerEpisode:
      chaptersPerEpisode > 0
        ? `${chaptersPerEpisode}章/集`
        : doc.chaptersPerEpisode
  })
}

export function formatPlotBreakdownEntry(entry: PlotBreakdownEntry): string {
  const episodeLabel =
    entry.episode && Number.isFinite(entry.episode)
      ? `，第${entry.episode}集`
      : ''
  return `【剧情${entry.index}】${entry.content}${episodeLabel}，状态：${entry.status}`
}

export function updatePlotBreakdownEntryStatus(
  raw: string,
  entryIndex: number,
  nextStatus: PlotBreakdownEntryStatus
): { content: string; updated: boolean } {
  const doc = parsePlotBreakdownMarkdown(raw)
  let updated = false

  for (const batch of doc.batches) {
    for (const entry of batch.entries) {
      if (entry.index !== entryIndex) continue
      entry.status = nextStatus
      updated = true
    }
  }

  return {
    content: updated ? serializePlotBreakdownMarkdown(doc) : raw,
    updated
  }
}

export function summarizePlotBreakdown(doc: PlotBreakdownDocument): {
  totalEntries: number
  usedEntries: number
  unusedEntries: number
  totalBatches: number
} {
  const entries = doc.batches.flatMap((batch) => batch.entries)
  const usedEntries = entries.filter((entry) => entry.status === '已用').length
  return {
    totalEntries: entries.length,
    usedEntries,
    unusedEntries: entries.length - usedEntries,
    totalBatches: doc.batches.length
  }
}

export function summarizePlotBreakdownWaterline(
  doc: PlotBreakdownDocument
): PlotBreakdownWaterlineSummary {
  const entries = doc.batches.flatMap((batch) => batch.entries)
  const usedEntries = entries.filter((entry) => entry.status === '已用').length
  const readyEpisodeNumbers = new Set<number>()
  const usedEpisodeNumbers = new Set<number>()

  for (const entry of entries) {
    if (!entry.episode) continue
    if (entry.status === '未用') readyEpisodeNumbers.add(entry.episode)
    if (entry.status === '已用') usedEpisodeNumbers.add(entry.episode)
  }

  const chapterStarts = doc.batches
    .map((batch) => batch.chapterStart)
    .filter((value): value is number => typeof value === 'number')
  const chapterEnds = doc.batches
    .map((batch) => batch.chapterEnd)
    .filter((value): value is number => typeof value === 'number')

  return {
    totalEntries: entries.length,
    usedEntries,
    unusedEntries: entries.length - usedEntries,
    totalBatches: doc.batches.length,
    readyEpisodeCount: readyEpisodeNumbers.size,
    readyEpisodeNumbers: [...readyEpisodeNumbers].sort((a, b) => a - b),
    usedEpisodeCount: usedEpisodeNumbers.size,
    usedEpisodeNumbers: [...usedEpisodeNumbers].sort((a, b) => a - b),
    chapterStart: chapterStarts.length > 0 ? Math.min(...chapterStarts) : null,
    chapterEnd: chapterEnds.length > 0 ? Math.max(...chapterEnds) : null,
    nextBatchNumber: doc.batches.length + 1
  }
}

export function getPlotBreakdownEntriesForEpisode(
  doc: PlotBreakdownDocument,
  episode: number,
  options: {
    status?: PlotBreakdownEntryStatus
  } = {}
): PlotBreakdownEntry[] {
  return doc.batches
    .flatMap((batch) => batch.entries)
    .filter((entry) => entry.episode === episode)
    .filter((entry) => (options.status ? entry.status === options.status : true))
}

export function formatPlotBreakdownEntriesMarkdown(
  entries: PlotBreakdownEntry[],
  options: {
    heading?: string
  } = {}
): string {
  const heading = options.heading || '# 当前集剧情点'
  if (entries.length === 0) {
    return `${heading}\n\n（暂无匹配剧情点）\n`
  }

  return `${heading}\n\n${entries.map((entry) => formatPlotBreakdownEntry(entry)).join('\n')}\n`
}

export function appendPlotBreakdownBatch(
  doc: PlotBreakdownDocument,
  params: {
    heading: string
    entries: PlotBreakdownEntry[]
    chapterStart?: number | null
    chapterEnd?: number | null
    replaceExistingHeading?: boolean
  }
): {
  document: PlotBreakdownDocument
  appendedEntries: number
} {
  const incoming = params.entries.filter((entry) => entry.content.trim())
  if (incoming.length === 0) {
    return { document: doc, appendedEntries: 0 }
  }

  const batches = params.replaceExistingHeading
    ? doc.batches.filter((batch) => batch.heading !== params.heading)
    : [...doc.batches]
  const maxIndex = batches
    .flatMap((batch) => batch.entries)
    .reduce((max, entry) => Math.max(max, entry.index), 0)

  const normalizedEntries = incoming.map((entry, offset) => ({
    ...entry,
    index: maxIndex + offset + 1,
    status: entry.status || '未用'
  }))

  return {
    document: {
      ...doc,
      batches: [
        ...batches,
        {
          heading: params.heading,
          chapterStart: params.chapterStart ?? null,
          chapterEnd: params.chapterEnd ?? null,
          entries: normalizedEntries
        }
      ]
    },
    appendedEntries: normalizedEntries.length
  }
}
