import { describe, expect, it } from 'vitest'
import { resolveBatchExecutionEpisodes } from './batch'
import { buildDefaultPlotBreakdownTemplate } from './project-bootstrap'
import {
  appendPlotBreakdownBatch,
  extractPlotBreakdownEntries,
  parsePlotBreakdownMarkdown,
  serializePlotBreakdownMarkdown,
  summarizePlotBreakdown,
  summarizePlotBreakdownWaterline
} from './plot-breakdown'

// 旧项目不需要重导或写回文件：读取时就必须忽略空占位批次。
const currentTemplate = buildDefaultPlotBreakdownTemplate({
  projectName: '测试小说',
  totalEpisodes: 30,
  chaptersPerEpisode: 4
})
const legacyTemplate = currentTemplate.replace(
  '> 暂无已发布剧情批次。首次拆解从第1批（第1-6章）开始，审核通过后追加到这里。',
  '### 第1批（第1-6章）\n\n[后续批次剧情将追加到这里]'
)

function smartNext(raw: string) {
  const waterline = summarizePlotBreakdownWaterline(
    parsePlotBreakdownMarkdown(raw)
  )
  return resolveBatchExecutionEpisodes({
    mode: 'smart_next',
    selectedEpisodes: [],
    allEpisodes: [1, 2, 3],
    waterline: {
      ...waterline,
      unprocessedChapterCount: 120 - (waterline.chapterEnd ?? 0),
      nextActionMode: waterline.unusedEntries > 0 ? 'script' : 'breakdown'
    }
  })
}

describe('bootstrap plot inventory waterline', () => {
  it('新模板不声明已发布的批次标题', () => {
    expect(currentTemplate).not.toMatch(/^### 第\d+批/m)
    expect(parsePlotBreakdownMarkdown(legacyTemplate).batches).toHaveLength(1)
  })

  it.each([
    ['新模板', currentTemplate],
    ['旧模板', legacyTemplate],
    ['空文件', '']
  ])('%s 从第1批开始，序列化也不能推进前6章', (_name, raw) => {
    const doc = parsePlotBreakdownMarkdown(raw)
    for (const content of [raw, serializePlotBreakdownMarkdown(doc)]) {
      const parsed = parsePlotBreakdownMarkdown(content)
      expect(summarizePlotBreakdown(parsed)).toEqual({
        totalEntries: 0,
        usedEntries: 0,
        unusedEntries: 0,
        totalBatches: 0
      })
      const waterline = summarizePlotBreakdownWaterline(parsed)
      expect(waterline).toMatchObject({
        totalEntries: 0,
        totalBatches: 0,
        chapterStart: null,
        chapterEnd: null,
        nextBatchNumber: 1,
        readyEpisodeNumbers: [],
        usedEpisodeNumbers: []
      })
      expect(waterline.chapterEnd ?? 0).toBe(0)
      expect(smartNext(content)).toEqual([1])
    }
  })

  it.each([currentTemplate, legacyTemplate])(
    '首次有效拆解发布第1批第1–6章，消费后仍保留水位',
    (raw) => {
      const result = appendPlotBreakdownBatch(parsePlotBreakdownMarkdown(raw), {
        heading: '### 第1批（第1-6章）',
        chapterStart: 1,
        chapterEnd: 6,
        replaceExistingHeading: true,
        entries: extractPlotBreakdownEntries(
          '【剧情1】院子，主角救人，第1集，状态：未用'
        )
      })
      expect(result.document.batches).toHaveLength(1)
      const serialized = serializePlotBreakdownMarkdown(result.document)
      const doc = parsePlotBreakdownMarkdown(serialized)
      expect(summarizePlotBreakdownWaterline(doc)).toMatchObject({
        totalEntries: 1,
        totalBatches: 1,
        chapterStart: 1,
        chapterEnd: 6,
        nextBatchNumber: 2,
        readyEpisodeNumbers: [1]
      })
      expect(smartNext(serialized)).toEqual([1])
      const consumed = serialized.replace('状态：未用', '状态：已用')
      expect(
        summarizePlotBreakdownWaterline(parsePlotBreakdownMarkdown(consumed))
      ).toMatchObject({
        totalEntries: 1,
        totalBatches: 1,
        unusedEntries: 0,
        usedEntries: 1,
        chapterEnd: 6,
        nextBatchNumber: 2,
        usedEpisodeNumbers: [1]
      })
      expect(smartNext(consumed)).toEqual([2])
    }
  )
})
