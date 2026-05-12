import { describe, expect, it } from 'vitest'
import {
  appendPlotBreakdownBatch,
  extractPlotBreakdownEntries,
  formatPlotBreakdownEntriesMarkdown,
  getPlotBreakdownEntriesForEpisode,
  parsePlotBreakdownMarkdown,
  serializePlotBreakdownMarkdown,
  summarizePlotBreakdown,
  summarizePlotBreakdownWaterline,
  updatePlotBreakdownPlanning,
  updatePlotBreakdownEntryStatus
} from './plot-breakdown'

describe('plot-breakdown', () => {
  it('可以解析旧版剧情点库存格式', () => {
    const doc = parsePlotBreakdownMarkdown(`# 剧情拆解

**小说名称**：《测试小说》
**小说类型**：穿越

## 改编规划

- **范围**：第1-120章
- **目标集数**：30 集
- **章节-集数分配原则**：4章/集

## 剧情列表

### 第1批（第1-6章）

【剧情1】陆家院子，陆青青救下大嫂，危机反转，第1集，状态：未用
【剧情2】宁家小院，陆青青逼宁修文还钱，打脸爽点，第1集，状态：已用
`)

    expect(doc.projectName).toBe('测试小说')
    expect(doc.projectType).toBe('穿越')
    expect(doc.range).toBe('第1-120章')
    expect(doc.chaptersPerEpisode).toBe('4章/集')
    expect(doc.batches).toHaveLength(1)
    expect(doc.batches[0]).toMatchObject({
      chapterStart: 1,
      chapterEnd: 6
    })
    expect(doc.batches[0].entries[0]).toMatchObject({
      index: 1,
      episode: 1,
      status: '未用'
    })
    expect(summarizePlotBreakdown(doc)).toEqual({
      totalEntries: 2,
      usedEntries: 1,
      unusedEntries: 1,
      totalBatches: 1
    })
    expect(summarizePlotBreakdownWaterline(doc)).toMatchObject({
      readyEpisodeCount: 1,
      readyEpisodeNumbers: [1],
      usedEpisodeCount: 1,
      usedEpisodeNumbers: [1],
      chapterStart: 1,
      chapterEnd: 6,
      nextBatchNumber: 2
    })
  })

  it('可以更新指定剧情点状态', () => {
    const result = updatePlotBreakdownEntryStatus(
      `# 剧情拆解

## 剧情列表

### 第1批（第1-6章）

【剧情1】院子，主角救人，危机反转，第1集，状态：未用
`,
      1,
      '已用'
    )

    expect(result.updated).toBe(true)
    expect(result.content).toContain('【剧情1】院子，主角救人，危机反转，第1集，状态：已用')
  })

  it('可以按集数筛选剧情点并转成 markdown 片段', () => {
    const doc = parsePlotBreakdownMarkdown(`# 剧情拆解

## 剧情列表

### 第1批（第1-6章）

【剧情1】院子，主角救人，危机反转，第1集，状态：未用
【剧情2】宁家，主角讨债，打脸爽点，第1集，状态：已用
【剧情3】路上，主角进城，命运转折，第2集，状态：未用
`)

    const entries = getPlotBreakdownEntriesForEpisode(doc, 1, {
      status: '未用'
    })

    expect(entries).toHaveLength(1)
    expect(entries[0].index).toBe(1)
    expect(formatPlotBreakdownEntriesMarkdown(entries)).toContain(
      '【剧情1】院子，主角救人，危机反转，第1集，状态：未用'
    )
  })

  it('可以从模型输出中提取剧情点并追加为新批次', () => {
    const base = parsePlotBreakdownMarkdown(`# 剧情拆解

## 剧情列表

### 第1批（第1-4章）

【剧情1】院子，主角救人，危机反转，第1集，状态：已用
`)
    const entries = extractPlotBreakdownEntries(`
# EP02 剧情拆解

【剧情99】宁家，主角追债，打脸爽点，第2集，状态：未用
【剧情100】县城，主角还债，危机解除，第2集，状态：未用
`)

    const result = appendPlotBreakdownBatch(base, {
      heading: '### 第2批（第5-8章）',
      chapterStart: 5,
      chapterEnd: 8,
      entries
    })
    const serialized = serializePlotBreakdownMarkdown(result.document)

    expect(result.appendedEntries).toBe(2)
    expect(serialized).toContain('### 第2批（第5-8章）')
    expect(serialized).toContain(
      '【剧情2】宁家，主角追债，打脸爽点，第2集，状态：未用'
    )
    expect(serialized).toContain(
      '【剧情3】县城，主角还债，危机解除，第2集，状态：未用'
    )
  })

  it('可以同步更新剧情库存改编规划但保留已有剧情点', () => {
    const next = updatePlotBreakdownPlanning(
      `# 剧情拆解

**小说名称**：《旧名》
**小说类型**：旧类型

## 改编规划

- **范围**：第1-40章
- **目标集数**：10 集
- **章节-集数分配原则**：4章/集
- **单集规格**：1500-2000字

## 剧情列表

### 第1批（第1-6章）

【剧情1】院子，主角救人，危机反转，第1集，状态：未用
`,
      {
        projectName: '新名',
        projectType: '漫剧',
        totalEpisodes: 30,
        chaptersPerEpisode: 3
      }
    )

    expect(next).toContain('**小说名称**：《新名》')
    expect(next).toContain('**小说类型**：漫剧')
    expect(next).toContain('- **范围**：第1-90章')
    expect(next).toContain('- **目标集数**：30 集')
    expect(next).toContain('- **章节-集数分配原则**：3章/集')
    expect(next).toContain('【剧情1】院子，主角救人')
  })
})
