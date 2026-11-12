export type PlotBreakdownEntryStatus = '未用' | '已用'

export interface PlotBreakdownEntry {
  /** 持久化身份；旧库存首次解析时由全局序号生成。 */
  id?: string
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
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function parseBatchHeading(line: string): {
  heading: string
  chapterStart: number | null
  chapterEnd: number | null
} | null {
  const match = line.match(/^###\s+第(\d+)批(?:[（(]第(\d+)-(\d+)章[）)])?/u)
  const legacy = line.match(/^###\s+第(\d+)-(\d+)章/u)
  if (!match && !legacy) return null
  return {
    heading: line.trim(),
    chapterStart: match?.[2]
      ? Number(match[2])
      : legacy
        ? Number(legacy[1])
        : null,
    chapterEnd: match?.[3]
      ? Number(match[3])
      : legacy
        ? Number(legacy[2])
        : null
  }
}

export function parsePlotBreakdownEntryLine(
  line: string
): PlotBreakdownEntry | null {
  const idMatch = line.match(/\s*<!--\s*plot-id:([\w-]+)\s*-->\s*$/u)
  const trimmed = line.replace(/\s*<!--\s*plot-id:[\w-]+\s*-->\s*$/u, '').trim()
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
    id: idMatch?.[1] || `plot-${index}`,
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

export function parsePlotBreakdownMarkdown(raw: string): PlotBreakdownDocument {
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
    targetEpisodes:
      totalEpisodes > 0 ? `${totalEpisodes} 集` : doc.targetEpisodes,
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
  return `【剧情${entry.index}】${entry.content}${episodeLabel}，状态：${entry.status}${entry.id ? ` <!-- plot-id:${entry.id} -->` : ''}`
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

// 人工旧库存可以没有集数绑定；有效内容与正整数序号足以证明批次已发布。
// 空标题/空内容不能推进水位，已消费剧情仍然属于已发布库存。
function getPublishedBatches(doc: PlotBreakdownDocument): PlotBreakdownBatch[] {
  return doc.batches.filter((batch) =>
    batch.entries.some(
      (entry) =>
        Number.isSafeInteger(entry.index) &&
        entry.index > 0 &&
        entry.content.trim().length > 0
    )
  )
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
    totalBatches: getPublishedBatches(doc).length
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

  const publishedBatches = getPublishedBatches(doc)
  const chapterStarts = publishedBatches
    .map((batch) => batch.chapterStart)
    .filter((value): value is number => typeof value === 'number')
  const chapterEnds = publishedBatches
    .map((batch) => batch.chapterEnd)
    .filter((value): value is number => typeof value === 'number')

  return {
    totalEntries: entries.length,
    usedEntries,
    unusedEntries: entries.length - usedEntries,
    totalBatches: publishedBatches.length,
    readyEpisodeCount: readyEpisodeNumbers.size,
    readyEpisodeNumbers: [...readyEpisodeNumbers].sort((a, b) => a - b),
    usedEpisodeCount: usedEpisodeNumbers.size,
    usedEpisodeNumbers: [...usedEpisodeNumbers].sort((a, b) => a - b),
    chapterStart: chapterStarts.length > 0 ? Math.min(...chapterStarts) : null,
    chapterEnd: chapterEnds.length > 0 ? Math.max(...chapterEnds) : null,
    // 仅显式发布的数字编号推进下一批；旧版章节标题/未分组库存不推断批次。
    // 稀疏编号保持原有最大编号续编规则，空占位标题无论编号多大都忽略。
    nextBatchNumber:
      Math.max(
        0,
        ...publishedBatches.map(
          (batch) => Number(batch.heading.match(/^###\s+第(\d+)批/u)?.[1]) || 0
        )
      ) + 1
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
    .filter((entry) =>
      options.status ? entry.status === options.status : true
    )
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
  validateGeneratedPlotBreakdownEntries(params.entries)
  const batchNumber = params.heading.match(/^###\s+第(\d+)批/u)?.[1]
  const previous = params.replaceExistingHeading
    ? doc.batches.find(
        (batch) =>
          batch.heading === params.heading ||
          (batchNumber &&
            batch.heading.match(/^###\s+第(\d+)批/u)?.[1] === batchNumber)
      )
    : undefined
  let maxIndex = Math.max(
    0,
    ...doc.batches.flatMap((batch) => batch.entries.map((entry) => entry.index))
  )
  const matched = new Set<PlotBreakdownEntry>()
  const normalizedEntries: PlotBreakdownEntry[] = params.entries.map(
    (entry, offset) => {
      const old =
        previous?.entries.find(
          (item) =>
            !matched.has(item) &&
            item.id === entry.id &&
            item.episode === entry.episode
        ) ||
        previous?.entries.find(
          (item) =>
            !matched.has(item) &&
            item.content === entry.content &&
            item.episode === entry.episode
        ) ||
        (previous?.entries[offset]?.episode === entry.episode &&
        !matched.has(previous.entries[offset])
          ? previous.entries[offset]
          : undefined)
      if (old) matched.add(old)
      const index = old?.index ?? ++maxIndex
      return {
        ...entry,
        index,
        id: old?.id || `plot-${index}`,
        status: old?.status || ('未用' as PlotBreakdownEntryStatus)
      }
    }
  )
  // 已绑定剧本的剧情不可因重新审核同批草稿而丢失。
  normalizedEntries.push(
    ...(previous?.entries.filter(
      (entry) => entry.status === '已用' && !matched.has(entry)
    ) || [])
  )
  const nextBatch = {
    heading: params.heading,
    chapterStart: params.chapterStart ?? null,
    chapterEnd: params.chapterEnd ?? null,
    entries: normalizedEntries
  }
  const batches = previous
    ? doc.batches.map((batch) => (batch === previous ? nextBatch : batch))
    : [...doc.batches, nextBatch]
  return {
    document: { ...doc, batches },
    appendedEntries: params.entries.length
  }
}

/** 模型输出必须可以完整绑定目标集，不能把空/缺集/越界输出当作成功。 */
export function validateGeneratedPlotBreakdownEntries(
  entries: PlotBreakdownEntry[],
  totalEpisodes?: number
): void {
  if (entries.length === 0) throw new Error('剧情拆解输出不包含有效剧情点')
  const indices = new Set<number>()
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.index) ||
      entry.index <= 0 ||
      indices.has(entry.index)
    ) {
      throw new Error('剧情点序号必须为不重复的正整数')
    }
    indices.add(entry.index)
    if (!entry.content.trim()) throw new Error('剧情点内容不能为空')
    if (
      !Number.isSafeInteger(entry.episode) ||
      !entry.episode ||
      entry.episode < 1 ||
      entry.episode > 10_000 ||
      (totalEpisodes && entry.episode > totalEpisodes)
    ) {
      throw new Error('剧情点必须绑定目标范围内的集数')
    }
  }
}

export function validateGeneratedPlotBreakdown(
  raw: string,
  totalEpisodes?: number
): PlotBreakdownEntry[] {
  const lines = normalizeMarkdownText(raw)
    .split('\n')
    .filter((line) => line.trim().startsWith('【剧情'))
  const entries = extractPlotBreakdownEntries(raw)
  if (lines.length !== entries.length)
    throw new Error('剧情拆解包含无法解析的剧情点')
  validateGeneratedPlotBreakdownEntries(entries, totalEpisodes)
  return entries
}
