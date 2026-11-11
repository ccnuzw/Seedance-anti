import { describe, expect, it } from 'vitest'
import { OutputParser } from './output-parser'

describe('output-parser', () => {
  it.each([
    '',
    '评分：8.5',
    'score: 6',
    'PASS',
    'FAIL',
    '❌ 拆解质检：FAIL',
    '可能 PASS，评分：9/10'
  ])('%s 缺少明确结论或合法分数时 INVALID', (text) => {
    expect(OutputParser.parseReview(text)).toMatchObject({
      result: 'INVALID',
      passed: false
    })
  })

  it.each([
    'PASS\n评分：11/10',
    'PASS\n评分：-1/10',
    'PASS\n评分：90/100',
    'PASS\nFAIL\n评分：9/10',
    '结论：PASS\n拆解质检：FAIL\n评分：9/10',
    '结论：PASS\n评分：8/10\n评分：9/10'
  ])('矛盾或越界评分保守无效：%s', (text) => {
    expect(OutputParser.parseReview(text)).toMatchObject({
      result: 'INVALID',
      passed: false
    })
  })

  it('兼容明确 Markdown 结论与 0 分，不从分数推断通过', () => {
    expect(
      OutputParser.parseReview('✅ **业务审核：PASS**\n**评分：8.5/10**')
    ).toMatchObject({ result: 'PASS', score: 8.5 })
    expect(OutputParser.parseReview('FAIL\n评分：0/10')).toMatchObject({
      result: 'FAIL',
      score: 0,
      passed: false
    })
    expect(
      OutputParser.parseReview('❌ 拆解质检：FAIL\n评分：9/10')
    ).toMatchObject({ result: 'FAIL', passed: false })
  })

  it('解析结构化 JSON 并按项目阈值判定，不信任多余 passed 字段', () => {
    const review = {
      result: 'PASS',
      score: 8,
      feedback: '逐项已核验',
      issues: []
    }
    expect(OutputParser.parseReview(JSON.stringify(review))).toMatchObject({
      result: 'PASS',
      passed: true
    })
    expect(OutputParser.parseReview(JSON.stringify(review), 9)).toMatchObject({
      result: 'FAIL',
      passed: false
    })
    expect(
      OutputParser.parseReview(JSON.stringify({ ...review, passed: false }))
    ).toMatchObject({ result: 'INVALID', passed: false })
    expect(
      OutputParser.parseReview(
        JSON.stringify({ ...review, feedback: '最终结论：FAIL' })
      )
    ).toMatchObject({ result: 'INVALID' })
  })

  it.each([
    '{}',
    '{"result":"PASS","score":8}',
    '{"result":"PASS","score":"8","feedback":"ok","issues":[]}',
    '{"result":"PASS","score":8,"feedback":"ok","issues":[{}]}',
    '{"result":"FAIL","result":"PASS","score":8,"feedback":"ok","issues":[]}',
    '{"result":"PASS","score":1e999,"feedback":"ok","issues":[]}'
  ])('结构化审核不合法时拒绝：%s', (text) => {
    expect(OutputParser.parseReview(text)).toMatchObject({
      result: 'INVALID',
      passed: false
    })
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
      结论：FAIL
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
