import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.fn()
const loadSkill = vi.fn()
const assembleReview = vi.fn()
const generate = vi.fn()

vi.mock('fs/promises', () => ({
  readFile
}))

vi.mock('./output-parser', () => ({
  OutputParser: {
    parseReview: vi.fn()
  }
}))

describe('review-engine', async () => {
  const { ReviewEngine } = await import('./review-engine')
  const { OutputParser } = await import('./output-parser')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reviewContent 会合并业务审核与合规审核结果，并以业务评分作为最终分数', async () => {
    loadSkill
      .mockResolvedValueOnce({ systemPrompt: 'business-skill' })
      .mockResolvedValueOnce({ systemPrompt: 'compliance-skill' })
    assembleReview
      .mockReturnValueOnce({ system: 'business-system', user: 'business-user' })
      .mockReturnValueOnce({
        system: 'compliance-system',
        user: 'compliance-user'
      })
    generate
      .mockResolvedValueOnce('business-response')
      .mockResolvedValueOnce('compliance-response')
    vi.mocked(OutputParser.parseReview)
      .mockReturnValueOnce({
        passed: true,
        score: 8,
        issues: [{ severity: 'minor', description: '节奏可更紧凑' }],
        feedback: '业务通过'
      })
      .mockReturnValueOnce({
        passed: false,
        score: 6,
        issues: [{ severity: 'critical', description: '存在合规风险' }],
        feedback: '合规不通过'
      })

    const engine = new ReviewEngine(
      { load: loadSkill } as never,
      { assembleReview } as never
    )
    engine.setProvider({ generate } as never)

    const result = await engine.reviewContent({
      stage: 'script_review',
      reviewSkillName: 'script-review-skill',
      outputToReview: '# output',
      originalScript: '# script'
    })

    expect(loadSkill).toHaveBeenNthCalledWith(1, 'script-review-skill')
    expect(loadSkill).toHaveBeenNthCalledWith(2, 'compliance-review-skill')
    expect(generate).toHaveBeenNthCalledWith(1, {
      system: 'business-system',
      user: 'business-user'
    })
    expect(generate).toHaveBeenNthCalledWith(2, {
      system: 'compliance-system',
      user: 'compliance-user'
    })
    expect(result.result).toBe('FAIL')
    expect(result.passed).toBe(false)
    expect(result.score).toBe(8)
    expect(result.issues).toEqual([
      { severity: 'minor', description: '节奏可更紧凑' },
      { severity: 'critical', description: '存在合规风险' }
    ])
    expect(result.feedback).toContain('## 业务审核: ✅ PASS (8分)')
    expect(result.feedback).toContain('## 合规审核: ❌ FAIL')
  })

  it('review(director) 会重新读取最新产物，并按阶段选择正确审核 skill', async () => {
    readFile.mockResolvedValueOnce('# director output')
    loadSkill
      .mockResolvedValueOnce({ systemPrompt: 'director-review-skill' })
      .mockResolvedValueOnce({ systemPrompt: 'compliance-review-skill' })
    assembleReview
      .mockReturnValueOnce({ system: 'director-system', user: 'director-user' })
      .mockReturnValueOnce({
        system: 'compliance-system',
        user: 'compliance-user'
      })
    generate
      .mockResolvedValueOnce('director-response')
      .mockResolvedValueOnce('compliance-response')
    vi.mocked(OutputParser.parseReview)
      .mockReturnValueOnce({
        passed: true,
        score: 9,
        issues: [],
        feedback: '业务通过'
      })
      .mockReturnValueOnce({
        passed: true,
        score: 9,
        issues: [],
        feedback: '合规通过'
      })

    const engine = new ReviewEngine(
      { load: loadSkill } as never,
      { assembleReview } as never
    )
    engine.setProvider({ generate } as never)

    const result = await engine.review('director', {
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectConfig: {
        directories: {
          outputsDir: 'deliverables'
        }
      }
    })

    expect(readFile).toHaveBeenCalledWith(
      '/tmp/project/deliverables/ep03/01-director-analysis.md',
      'utf-8'
    )
    expect(loadSkill).toHaveBeenNthCalledWith(1, 'script-analysis-review-skill')
    expect(result.result).toBe('PASS')
    expect(result.score).toBe(9)
  })

  it('reviewContent 会把显式传入的剧情库存作为对照输入传给审核 prompt', async () => {
    loadSkill
      .mockResolvedValueOnce({ systemPrompt: 'script-review-skill' })
      .mockResolvedValueOnce({ systemPrompt: 'compliance-review-skill' })
    assembleReview
      .mockReturnValueOnce({ system: 'business-system', user: 'business-user' })
      .mockReturnValueOnce({
        system: 'compliance-system',
        user: 'compliance-user'
      })
    generate
      .mockResolvedValueOnce('business-response')
      .mockResolvedValueOnce('compliance-response')
    vi.mocked(OutputParser.parseReview)
      .mockReturnValueOnce({
        passed: true,
        score: 8,
        issues: [],
        feedback: '业务通过'
      })
      .mockReturnValueOnce({
        passed: true,
        score: 8,
        issues: [],
        feedback: '合规通过'
      })

    const engine = new ReviewEngine(
      { load: loadSkill } as never,
      { assembleReview } as never
    )
    engine.setProvider({ generate } as never)

    await engine.reviewContent({
      stage: 'script_review',
      reviewSkillName: 'script-review-skill',
      outputToReview: '# script output',
      originalScript: '# script output',
      plotBreakdown:
        '# 当前集剧情点\n\n【剧情1】院子，主角救人，危机反转，第1集，状态：未用\n'
    })

    expect(assembleReview).toHaveBeenNthCalledWith(
      1,
      { systemPrompt: 'script-review-skill' },
      expect.any(String),
      '# script output',
      '# script output',
      undefined,
      '# 当前集剧情点\n\n【剧情1】院子，主角救人，危机反转，第1集，状态：未用\n'
    )
  })

  it('review(storyboard) 会尝试附带读取导演分析作为对照，但缺失时不报错', async () => {
    readFile
      .mockResolvedValueOnce('# prompts output')
      .mockRejectedValueOnce(new Error('missing director analysis'))
    loadSkill
      .mockResolvedValueOnce({ systemPrompt: 'storyboard-review-skill' })
      .mockResolvedValueOnce({ systemPrompt: 'compliance-review-skill' })
    assembleReview
      .mockReturnValueOnce({
        system: 'storyboard-system',
        user: 'storyboard-user'
      })
      .mockReturnValueOnce({
        system: 'compliance-system',
        user: 'compliance-user'
      })
    generate
      .mockResolvedValueOnce('storyboard-response')
      .mockResolvedValueOnce('compliance-response')
    vi.mocked(OutputParser.parseReview)
      .mockReturnValueOnce({
        passed: true,
        score: 8,
        issues: [],
        feedback: '业务通过'
      })
      .mockReturnValueOnce({
        passed: true,
        score: 8,
        issues: [],
        feedback: '合规通过'
      })

    const engine = new ReviewEngine(
      { load: loadSkill } as never,
      { assembleReview } as never
    )
    engine.setProvider({ generate } as never)

    const result = await engine.review('storyboard', {
      projectPath: '/tmp/project',
      episodeNum: 6,
      projectConfig: {
        directories: {
          outputsDir: 'deliverables'
        }
      }
    })

    expect(readFile).toHaveBeenNthCalledWith(
      1,
      '/tmp/project/deliverables/ep06/02-seedance-prompts.md',
      'utf-8'
    )
    expect(readFile).toHaveBeenNthCalledWith(
      2,
      '/tmp/project/deliverables/ep06/01-director-analysis.md',
      'utf-8'
    )
    expect(result.result).toBe('PASS')
  })
})
