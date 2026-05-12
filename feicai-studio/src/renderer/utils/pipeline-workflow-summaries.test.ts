import { describe, expect, it } from 'vitest'
import { buildWorkflowSummaries } from './pipeline-workflow-summaries'

describe('pipeline-workflow-summaries', () => {
  it('会根据素材文本与集数统计构建摘要', () => {
    const result = buildWorkflowSummaries(
      {
        novelRaw: '第一行\n第二行',
        storyRaw: '### Beat 1\n内容\n### Beat 2',
        scriptRaw: '## 场景 1\n台词\n## 场景 2',
        scriptReviewRaw: '# 审核\n- 评分：8/10',
        directorRaw: '1. 镜头A\n2. 镜头B',
        characterRaw: '## 角色A\n描述',
        artRaw: '服化道\n更多细节',
        promptsRaw: '## prompt1\n内容\n## prompt2',
        storyboardReviewRaw: '- 评分：7/10'
      },
      {
        id: 'ep-1',
        projectId: 'p1',
        episodeNumber: 1,
        title: '第1集',
        status: 'script',
        hasStoryBeat: true,
        hasScript: true,
        hasScriptReview: true,
        hasDirectorAnalysis: true,
        hasCharacterDesign: true,
        hasArtDesign: true,
        hasStoryboard: false,
        hasSeedancePrompts: true,
        hasStoryboardReview: true,
        totalPrompts: 2,
        totalDurationSeconds: 18,
        createdAt: '',
        updatedAt: ''
      }
    )

    expect(result.hasSourceNovel).toBe(true)
    expect(result.summaryMap.novel).toEqual(['原文 2 行'])
    expect(result.summaryMap.story).toEqual(['2 个 beats', '3 行内容'])
    expect(result.summaryMap.script).toEqual(['2 个场景', '3 行剧本'])
    expect(result.summaryMap.script_review).toEqual(['审核评分 8/10'])
    expect(result.summaryMap.storyboard).toEqual(['2 条提示词', '总时长 18s'])
    expect(result.summaryMap.storyboard_review).toEqual(['审核评分 7/10'])
  })

  it('在缺少原文时不会标记 novel 摘要', () => {
    const result = buildWorkflowSummaries({
      novelRaw: null,
      storyRaw: null,
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
