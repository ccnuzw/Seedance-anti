import { describe, expect, it } from 'vitest'
import { buildDefaultPlotBreakdownTemplate } from './project-bootstrap'
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
  updatePlotBreakdownEntryStatus,
  validateGeneratedPlotBreakdown
} from './plot-breakdown'

describe('plot-breakdown', () => {
  it.each([false, true])(
    'updates bootstrap planning without retaining old metadata (legacy duplicates=%s)',
    (duplicates) => {
      let original = buildDefaultPlotBreakdownTemplate({
        projectName: '设置前',
        totalEpisodes: 2,
        chaptersPerEpisode: 3
      }).replace(
        '## 剧情列表',
        '- 自定义说明：目标集数待人工确认，范围与章节原则见正文\n\n## 剧情列表'
      )
      if (duplicates) {
        original = original.replace(
          '## 改编规划',
          '## 改编规划\n- **范围**：第1-8章\n- **目标集数**：8 集\n- **章节-集数分配原则**：1章/集'
        )
      }
      original +=
        '\n### 第1批（第1-6章）\n\n【剧情1】院子，主角救人，反转，第1集，状态：已用\n'
      const before = parsePlotBreakdownMarkdown(original)
      let next = updatePlotBreakdownPlanning(original, {
        projectName: '设置后',
        totalEpisodes: 4,
        chaptersPerEpisode: 5
      })
      for (const params of [
        { totalEpisodes: 4, chaptersPerEpisode: 5 },
        { totalEpisodes: 6, chaptersPerEpisode: 7 },
        { totalEpisodes: 4, chaptersPerEpisode: 5 }
      ]) {
        next = updatePlotBreakdownPlanning(next, params)
        const parsed = parsePlotBreakdownMarkdown(next)
        expect(parsed.range).toBe(
          `第1-${params.totalEpisodes * params.chaptersPerEpisode}章`
        )
        expect(parsed.targetEpisodes).toBe(`${params.totalEpisodes} 集`)
        expect(parsed.chaptersPerEpisode).toBe(
          `${params.chaptersPerEpisode}章/集`
        )
        expect(parsed.batches).toEqual(before.batches)
        for (const field of ['范围', '目标集数', '章节-集数分配原则']) {
          expect(next.split(`- **${field}**：`)).toHaveLength(2)
        }
        expect(parsed.planningLines).toContain(
          '- 自定义说明：目标集数待人工确认，范围与章节原则见正文'
        )
        expect(next).toContain('- **单集规格**：1500-2000字')
        expect(next).toContain('- **分段规划**：第1-10集对应第1-40章')
      }
      expect(parsePlotBreakdownMarkdown(next)).toMatchObject({
        projectName: '设置后',
        range: '第1-20章',
        targetEpisodes: '4 集',
        chaptersPerEpisode: '5章/集'
      })
      expect(
        updatePlotBreakdownPlanning(next, {
          totalEpisodes: 4,
          chaptersPerEpisode: 5
        })
      ).toBe(next)
    }
  )

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
    expect(result.content).toContain(
      '【剧情1】院子，主角救人，危机反转，第1集，状态：已用'
    )
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

describe('plot-breakdown published batches', () => {
  it('空批次混合有效批次时只累计已发布范围与编号，往返不改变结果', () => {
    const doc = parsePlotBreakdownMarkdown(`## 剧情列表
### 第99批（第100-600章）
[待追加]
### 第1批（第1-6章）
【剧情1】人工剧情，状态：已用
### 第2批（第7-12章）
### 第3批（第13-18章）
【剧情2】后批剧情，第3集，状态：未用
### 第100批（第601-606章）
`)
    for (const parsed of [
      doc,
      parsePlotBreakdownMarkdown(serializePlotBreakdownMarkdown(doc))
    ]) {
      expect(summarizePlotBreakdown(parsed)).toEqual({
        totalEntries: 2,
        usedEntries: 1,
        unusedEntries: 1,
        totalBatches: 2
      })
      expect(summarizePlotBreakdownWaterline(parsed)).toMatchObject({
        totalBatches: 2,
        chapterStart: 1,
        chapterEnd: 18,
        nextBatchNumber: 4,
        readyEpisodeNumbers: [3],
        usedEpisodeNumbers: []
      })
    }
  })

  it('只有空内容或无效序号的批次不能声明章节已处理', () => {
    const doc = parsePlotBreakdownMarkdown(`## 剧情列表
### 第8批（第1-48章）
【剧情1】，第1集，状态：未用
【剧情0】内容，第1集，状态：未用
`)
    expect(summarizePlotBreakdownWaterline(doc)).toMatchObject({
      totalBatches: 0,
      chapterStart: null,
      chapterEnd: null,
      nextBatchNumber: 1
    })
  })

  it.each([
    ['### 第8批（第1-6章）', 9, 6],
    ['### 第1-6章', 1, 6],
    ['', 1, null]
  ])(
    '人工有效库存 %s 使用显式编号，不用批次数推断范围',
    (heading, nextBatchNumber, chapterEnd) => {
      const doc = parsePlotBreakdownMarkdown(
        `## 剧情列表\n${heading}\n【剧情1】人工保留内容，状态：已用`
      )
      expect(summarizePlotBreakdownWaterline(doc)).toMatchObject({
        totalBatches: 1,
        totalEntries: 1,
        usedEntries: 1,
        unusedEntries: 0,
        nextBatchNumber,
        chapterEnd
      })
    }
  )

  it('多个未编号旧批次不会凭批次数跳过章节或批次', () => {
    const doc = parsePlotBreakdownMarkdown(`## 剧情列表
### 第1-2章
【剧情1】甲
### 第3-4章
【剧情2】乙
`)
    expect(summarizePlotBreakdownWaterline(doc)).toMatchObject({
      totalBatches: 2,
      chapterStart: 1,
      chapterEnd: 4,
      nextBatchNumber: 1
    })
  })
})

describe('plot-breakdown stable identity', () => {
  it('替换旧批次不重编号其他批次，保留已用身份并在往返后稳定', () => {
    const base = parsePlotBreakdownMarkdown(
      '# 剧情拆解\n\n## 剧情列表\n\n### 第1批（第1-6章）\n\n【剧情1】旧剧情，第1集，状态：已用\n\n### 第3批（第13-18章）\n\n【剧情8】后批剧情，第3集，状态：未用\n'
    )
    const replacement = appendPlotBreakdownBatch(base, {
      heading: '### 第1批（第1-5章）',
      chapterStart: 1,
      chapterEnd: 5,
      replaceExistingHeading: true,
      entries: extractPlotBreakdownEntries(
        '【剧情99】修订剧情，第1集，状态：未用\n【剧情100】新剧情，第2集，状态：未用'
      )
    }).document
    expect(replacement.batches).toHaveLength(2)
    expect(replacement.batches[0].entries[0]).toMatchObject({
      id: 'plot-1',
      index: 1,
      status: '已用',
      content: '修订剧情'
    })
    expect(replacement.batches[0].entries[1]).toMatchObject({
      id: 'plot-9',
      index: 9,
      status: '未用'
    })
    expect(replacement.batches[1].entries[0]).toMatchObject({
      id: 'plot-8',
      index: 8
    })
    const reread = parsePlotBreakdownMarkdown(
      serializePlotBreakdownMarkdown(replacement)
    )
    expect(reread.batches[0].entries[0].id).toBe('plot-1')
    expect(summarizePlotBreakdownWaterline(reread).nextBatchNumber).toBe(4)
  })

  it('重审删除的已用剧情仍保留其剧本绑定', () => {
    const base = parsePlotBreakdownMarkdown(
      '# 剧情拆解\n\n## 剧情列表\n\n### 第1批\n\n【剧情1】已绑定剧情，第1集，状态：已用\n'
    )
    const next = appendPlotBreakdownBatch(base, {
      heading: '### 第1批',
      replaceExistingHeading: true,
      entries: extractPlotBreakdownEntries(
        '【剧情1】其他集剧情，第2集，状态：未用'
      )
    }).document
    expect(getPlotBreakdownEntriesForEpisode(next, 1)[0]).toMatchObject({
      id: 'plot-1',
      content: '已绑定剧情',
      status: '已用'
    })
    expect(getPlotBreakdownEntriesForEpisode(next, 2)[0].index).toBe(2)
  })

  it.each([
    '',
    '【剧情1】\n',
    '【剧情1】内容，状态：未用',
    '【剧情0】内容，第1集，状态：未用',
    '【剧情1】内容，第3集，状态：未用',
    '【剧情1】甲，第1集\n【剧情1】乙，第1集'
  ])('无效模型结构不会进入库存：%s', (raw) => {
    expect(() => validateGeneratedPlotBreakdown(raw, 2)).toThrow()
  })
})
