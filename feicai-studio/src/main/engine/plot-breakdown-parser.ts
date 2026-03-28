// ============================================================
// Plot Breakdown Parser — 剧情拆解解析器
// ============================================================
//
// 解析 plot-breakdown.md 的内容，提取剧情点、批次信息和资源水位

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { PlotPoint, WaterLevel } from '@shared/types'
import { getExistingScriptEpisodeSet } from '../project/script-file-utils'

/** 剧情点匹配正则：【剧情N】场景，描述，钩子类型，第X集，状态：未用/已用 */
const PLOT_PATTERN = /【剧情(\d+)】(.+?)，(.+?)，(.+?)，第(\d+)集，状态[：:]\s*(未用|已用)/g

/** 批次匹配正则：### 第X批（第X-X章） */
const BATCH_PATTERN = /### 第(\d+)批（第(\d+)-(\d+)章）/g

export interface BatchInfo {
  batchNumber: number
  chapterStart: number
  chapterEnd: number
  plots: PlotPoint[]
}

interface BatchBlock extends BatchInfo {
  startIndex: number
  endIndex: number
  rawContent: string
}

export class PlotBreakdownParser {
  private getBatchBlocks(content: string): BatchBlock[] {
    const batchRegex = /###\s*第\s*(\d+)\s*批\s*[（(]\s*第\s*(\d+)\s*-\s*(\d+)\s*章\s*[）)]/g
    const positions: Array<{
      batchNumber: number
      chapterStart: number
      chapterEnd: number
      startIndex: number
    }> = []
    let match: RegExpExecArray | null

    while ((match = batchRegex.exec(content)) !== null) {
      positions.push({
        batchNumber: parseInt(match[1]),
        chapterStart: parseInt(match[2]),
        chapterEnd: parseInt(match[3]),
        startIndex: match.index
      })
    }

    return positions.map((position, index) => {
      const endIndex = index + 1 < positions.length ? positions[index + 1].startIndex : content.length
      const rawContent = content.substring(position.startIndex, endIndex).trim()
      const parsed = this.parse(rawContent)
      return {
        ...position,
        startIndex: position.startIndex,
        endIndex,
        rawContent,
        plots: parsed.allPlots
      }
    })
  }

  /**
   * 解析 plot-breakdown.md 为结构化数据
   */
  parse(content: string): {
    title: string
    genre: string
    batches: BatchInfo[]
    allPlots: PlotPoint[]
  } {
    // 解析标题和类型
    const titleMatch = content.match(/\*\*小说名称\*\*[：:]\s*《(.+?)》/)
    const genreMatch = content.match(/\*\*小说类型\*\*[：:]\s*(.+)/)
    const title = titleMatch?.[1] || ''
    const genre = genreMatch?.[1]?.trim() || ''

    // 解析批次
    const batches: BatchInfo[] = []
    const batchRegex = /###\s*第\s*(\d+)\s*批\s*[（(]\s*第\s*(\d+)\s*-\s*(\d+)\s*章\s*[）)]/g
    let batchMatch: RegExpExecArray | null

    // 先收集所有批次位置
    const batchPositions: Array<{
      batchNumber: number
      chapterStart: number
      chapterEnd: number
      startIndex: number
    }> = []

    while ((batchMatch = batchRegex.exec(content)) !== null) {
      batchPositions.push({
        batchNumber: parseInt(batchMatch[1]),
        chapterStart: parseInt(batchMatch[2]),
        chapterEnd: parseInt(batchMatch[3]),
        startIndex: batchMatch.index
      })
    }

    // 解析每个批次中的剧情点
    const allPlots: PlotPoint[] = []

    for (let i = 0; i < batchPositions.length; i++) {
      const bp = batchPositions[i]
      const nextStart = i + 1 < batchPositions.length
        ? batchPositions[i + 1].startIndex
        : content.length

      const batchContent = content.substring(bp.startIndex, nextStart)
      const plots: PlotPoint[] = []

      const plotRegex = /【剧情\s*(\d+)\s*】\s*(.+?)[，,]\s*(.+?)[，,]\s*(.+?)[，,]\s*第\s*(\d+)\s*集[，,]\s*状态[：:]\s*(未用|已用)/g
      let plotMatch: RegExpExecArray | null

      while ((plotMatch = plotRegex.exec(batchContent)) !== null) {
        const plot: PlotPoint = {
          id: parseInt(plotMatch[1]),
          scene: plotMatch[2].trim(),
          description: plotMatch[3].trim(),
          hookType: plotMatch[4].trim(),
          episode: parseInt(plotMatch[5]),
          status: plotMatch[6] === '已用' ? 'used' : 'unused',
          batch: bp.batchNumber
        }
        plots.push(plot)
        allPlots.push(plot)
      }

      batches.push({
        batchNumber: bp.batchNumber,
        chapterStart: bp.chapterStart,
        chapterEnd: bp.chapterEnd,
        plots
      })
    }

    return { title, genre, batches, allPlots }
  }

  /**
   * 获取未用剧情点
   */
  getUnusedPlots(content: string): PlotPoint[] {
    const { allPlots } = this.parse(content)
    return allPlots.filter(p => p.status === 'unused')
  }

  /**
   * 标记剧情点为已用
   */
  markPlotsAsUsed(content: string, plotIds: number[]): string {
    let result = content
    for (const id of plotIds) {
      const pattern = new RegExp(
        `(【剧情\\s*${id}\\s*】.+?[，,]\\s*状态[：:]\\s*)未用`,
        'g'
      )
      result = result.replace(pattern, '$1已用')
    }
    return result
  }

  /**
   * 追加新批次到 plot-breakdown.md 末尾
   */
  appendBatch(content: string, newBatchContent: string): string {
    // 在最后的 --- 分割线之前插入，或直接追加
    const lastSeparator = content.lastIndexOf('\n---\n')
    if (lastSeparator > 0) {
      return content.substring(0, lastSeparator) + '\n\n' + newBatchContent + '\n\n---\n'
    }
    return content + '\n\n' + newBatchContent + '\n'
  }

  /**
   * [BUG-2] 移除指定批次内容（用于 checkBreakdown 自动修正前清理）
   */
  removeBatch(content: string, batchNumber: number): string {
    const batchRegex = /###\s*第\s*(\d+)\s*批\s*[（(]\s*第\s*\d+\s*-\s*\d+\s*章\s*[）)]/g
    let match: RegExpExecArray | null
    const positions: Array<{ batchNum: number; start: number }> = []

    while ((match = batchRegex.exec(content)) !== null) {
      positions.push({ batchNum: parseInt(match[1]), start: match.index })
    }

    const targetIdx = positions.findIndex(p => p.batchNum === batchNumber)
    if (targetIdx === -1) return content // 没找到该批次

    const startPos = positions[targetIdx].start
    const endPos = targetIdx + 1 < positions.length
      ? positions[targetIdx + 1].start
      : content.length

    // 删除该批次区域
    return (content.substring(0, startPos) + content.substring(endPos)).replace(/\n{3,}/g, '\n\n')
  }

  removeBatchesInChapterRange(content: string, chapterStart: number, chapterEnd: number): string {
    const blocks = this.getBatchBlocks(content)
    const keptBlocks = blocks.filter(
      (block) => block.chapterEnd < chapterStart || block.chapterStart > chapterEnd
    )

    if (keptBlocks.length === blocks.length) return content

    const firstBatchStart = blocks[0]?.startIndex ?? content.length
    const header = content.substring(0, firstBatchStart).trimEnd()
    const body = keptBlocks
      .sort((a, b) => a.batchNumber - b.batchNumber || a.chapterStart - b.chapterStart)
      .map((block) => block.rawContent.trim())
      .join('\n\n')

    if (!body) {
      return `${header}\n\n---\n`
    }

    return `${header}\n\n${body}\n\n---\n`
  }

  sortBatches(content: string): string {
    const blocks = this.getBatchBlocks(content)
    if (blocks.length <= 1) return content

    const firstBatchStart = blocks[0]?.startIndex ?? content.length
    const header = content.substring(0, firstBatchStart).trimEnd()
    const body = blocks
      .sort((a, b) => a.batchNumber - b.batchNumber || a.chapterStart - b.chapterStart)
      .map((block) => block.rawContent.trim())
      .join('\n\n')

    return `${header}\n\n${body}\n\n---\n`
  }

  getChapterRangeForEpisodeRange(content: string, episodeStart: number, episodeEnd: number): {
    chapterStart: number
    chapterEnd: number
    batchNumbers: number[]
  } | null {
    const { batches } = this.parse(content)
    const normalizedStart = Math.min(episodeStart, episodeEnd)
    const normalizedEnd = Math.max(episodeStart, episodeEnd)

    const relatedBatches = batches.filter((batch) =>
      batch.plots.some((plot) => plot.episode >= normalizedStart && plot.episode <= normalizedEnd)
    )

    if (relatedBatches.length === 0) return null

    return {
      chapterStart: Math.min(...relatedBatches.map((batch) => batch.chapterStart)),
      chapterEnd: Math.max(...relatedBatches.map((batch) => batch.chapterEnd)),
      batchNumbers: relatedBatches.map((batch) => batch.batchNumber).sort((a, b) => a - b)
    }
  }

  /**
   * 计算资源水位
   */
  getWaterLevel(content: string, totalChapters: number): WaterLevel {
    return this.getWaterLevelForProject(content, totalChapters)
  }

  getWaterLevelForProject(content: string, totalChapters: number, projectPath?: string): WaterLevel {
    const { allPlots, batches } = this.parse(content)

    const unusedPlots = allPlots.filter(p => p.status === 'unused').length
    const lastBatch = batches.length > 0
      ? batches[batches.length - 1]
      : null
    const processedChapters = lastBatch ? lastBatch.chapterEnd : 0

    const plotsByEpisode = new Map<number, { used: number; unused: number }>()
    for (const plot of allPlots) {
      const current = plotsByEpisode.get(plot.episode) || { used: 0, unused: 0 }
      if (plot.status === 'used') {
        current.used += 1
      } else {
        current.unused += 1
      }
      plotsByEpisode.set(plot.episode, current)
    }

    const assignedEpisodes = plotsByEpisode.size
    const fullyUsedEpisodes = [...plotsByEpisode.values()]
      .filter((entry) => entry.used > 0 && entry.unused === 0)
      .length
    const partialUsedEpisodes = [...plotsByEpisode.values()]
      .filter((entry) => entry.used > 0 && entry.unused > 0)
      .length

    const scriptEpisodesSet = projectPath ? getExistingScriptEpisodeSet(projectPath) : new Set<number>()
    const scriptEpisodes = scriptEpisodesSet.size
    const pendingScriptEpisodes = [...plotsByEpisode.keys()]
      .filter((episode) => !scriptEpisodesSet.has(episode))
      .length

    return {
      unusedPlots,
      unprocessedChapters: totalChapters - processedChapters,
      completedEpisodes: scriptEpisodes,
      totalPlots: allPlots.length,
      totalChapters,
      processedChapters,
      assignedEpisodes,
      scriptEpisodes,
      pendingScriptEpisodes,
      fullyUsedEpisodes,
      partialUsedEpisodes
    }
  }

  /**
   * 按集数分组获取未用剧情点
   */
  getUnusedPlotsByEpisode(content: string): Record<number, PlotPoint[]> {
    const unused = this.getUnusedPlots(content)
    const grouped: Record<number, PlotPoint[]> = {}

    for (const plot of unused) {
      if (!grouped[plot.episode]) {
        grouped[plot.episode] = []
      }
      grouped[plot.episode].push(plot)
    }

    return grouped
  }

  /**
   * 从文件读取并解析
   */
  async parseFile(projectPath: string): Promise<ReturnType<PlotBreakdownParser['parse']> | null> {
    try {
      const content = await readFile(join(projectPath, 'plot-breakdown.md'), 'utf-8')
      return this.parse(content)
    } catch {
      return null
    }
  }

  /**
   * 从文件读取水位
   */
  async getWaterLevelFromFile(projectPath: string, totalChapters: number): Promise<WaterLevel> {
    try {
      const content = await readFile(join(projectPath, 'plot-breakdown.md'), 'utf-8')
      return this.getWaterLevelForProject(content, totalChapters, projectPath)
    } catch {
      return {
        unusedPlots: 0,
        unprocessedChapters: totalChapters,
        completedEpisodes: 0,
        totalPlots: 0,
        totalChapters,
        processedChapters: 0,
        assignedEpisodes: 0,
        scriptEpisodes: 0,
        pendingScriptEpisodes: 0,
        fullyUsedEpisodes: 0,
        partialUsedEpisodes: 0
      }
    }
  }
}
