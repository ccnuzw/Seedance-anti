import { describe, expect, it } from 'vitest'
import { OutputParser } from './output-parser'

describe('output-parser', () => {
  it('parseReview 在无明确结论时会按分数阈值判定 PASS/FAIL', () => {
    const passResult = OutputParser.parseReview(
      `
      评分：8.5
      整体表现稳定，节奏基本成立。
    `,
      7
    )

    const failResult = OutputParser.parseReview(
      `
      score: 6
      情绪推进仍显不足。
    `,
      7
    )

    expect(passResult.passed).toBe(true)
    expect(passResult.score).toBe(8.5)
    expect(failResult.passed).toBe(false)
    expect(failResult.score).toBe(6)
  })

  it('parseReview 中明确 FAIL 标记会覆盖高分，明确 PASS 仍需满足阈值', () => {
    const failResult = OutputParser.parseReview(
      `
      评分：9
      结论：FAIL
      ❌ 关键镜头衔接错误
    `,
      7
    )

    const passResult = OutputParser.parseReview(
      `
      评分：5
      ✅ PASS
      存在一些轻微问题，但整体可通过
    `,
      7
    )

    expect(failResult.passed).toBe(false)
    expect(passResult.passed).toBe(false)
  })

  it('parseReview 会提取问题项并推断严重程度', () => {
    const result = OutputParser.parseReview(
      `
      评分：6
      问题1：严重缺失转场镜头
      ⚠️ 节奏不足，铺垫略长
      **问题2**: minor wording issue
    `,
      7
    )

    expect(result.issues).toHaveLength(3)
    expect(result.issues).toContainEqual({
      severity: 'critical',
      description: '严重缺失转场镜头',
      suggestion: undefined
    })
    expect(result.issues).toContainEqual({
      severity: 'major',
      description: '节奏不足，铺垫略长',
      suggestion: undefined
    })
    expect(result.issues).toContainEqual({
      severity: 'minor',
      description: 'minor wording issue',
      suggestion: undefined
    })
  })

  it('parseDirectorAnalysis 会统计剧情点数，并在缺少总时长时回退累加单点时长', () => {
    const result = OutputParser.parseDirectorAnalysis(`
      P01 开场 5秒
      剧情点 2 冲突升级 7秒
      P03 反转 8秒
    `)

    expect(result.plotPoints).toBe(3)
    expect(result.totalDuration).toBe(20)
  })

  it('parseSeedancePrompts 会统计提示词条数与总时长', () => {
    const result = OutputParser.parseSeedancePrompts(`
P01
时长：5秒
提示词2
duration: 8s
P03
时长: 6秒
    `)

    expect(result.promptCount).toBe(3)
    expect(result.totalDuration).toBe(19)
  })
})
