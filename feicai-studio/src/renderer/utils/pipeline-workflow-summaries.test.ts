import { describe, expect, it } from 'vitest'
import { buildWorkflowSummaries } from './pipeline-workflow-summaries'

describe('pipeline-workflow-summaries', () => {
  it('原始审核文案与提示词存在不能自行声称审核通过或制作完成', () => {
    const result = buildWorkflowSummaries({
      novelRaw: null,
      storyRaw: null,
      storyReviewRaw: null,
      scriptRaw: '# 剧本正文',
      scriptReviewRaw: '结论：PASS\n评分：10/10',
      directorRaw: null,
      characterRaw: null,
      artRaw: null,
      promptsRaw: '## prompt1\n未获当前有效审核的分镜',
      storyboardReviewRaw: '结论：PASS\n评分：10/10'
    })
    expect(result.summaryMap.script_approved).toBeUndefined()
    expect(result.summaryMap.complete).toBeUndefined()
  })

  it('在缺少原文时不会标记 novel 摘要', () => {
    const result = buildWorkflowSummaries({
      novelRaw: null,
      storyRaw: null,
      storyReviewRaw: null,
      scriptRaw: null,
      scriptReviewRaw: null,
      directorRaw: null,
      characterRaw: null,
      artRaw: null,
      promptsRaw: null,
      storyboardReviewRaw: null
    })
    expect(result.hasSourceNovel).toBe(false)
    expect(result.summaryMap).toEqual({})
  })
})
