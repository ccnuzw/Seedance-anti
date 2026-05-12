import { describe, expect, it } from 'vitest'
import { formatReviewMarkdown, parseReviewMarkdown } from './review-artifacts'
import type { ReviewResult } from './types'

describe('review-artifacts', () => {
  const sampleReview: ReviewResult = {
    stage: 'script_review',
    reviewType: 'business',
    result: 'FAIL',
    passed: false,
    score: 6.5,
    feedback: '节奏尚可，但中段冲突不够，结尾钩子偏弱。',
    issues: [
      {
        severity: 'major',
        description: '中段冲突不足',
        location: '第二幕',
        suggestion: '补一段角色对抗'
      },
      {
        severity: 'minor',
        description: '结尾钩子不够强'
      }
    ],
    createdAt: '2026-05-07T10:00:00.000Z'
  }

  it('能把 ReviewResult 格式化并再解析回来', () => {
    const markdown = formatReviewMarkdown('剧本审核', sampleReview)
    const parsed = parseReviewMarkdown(markdown, 'script_review')

    expect(parsed).not.toBeNull()
    expect(parsed?.result).toBe('FAIL')
    expect(parsed?.passed).toBe(false)
    expect(parsed?.score).toBe(6.5)
    expect(parsed?.issues).toHaveLength(2)
    expect(parsed?.issues[0].location).toBe('第二幕')
  })

  it('缺少关键段落时返回 null', () => {
    const parsed = parseReviewMarkdown(
      '# bad file\n- 结果：PASS',
      'script_review'
    )
    expect(parsed).toBeNull()
  })
})
