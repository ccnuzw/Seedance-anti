import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ProjectConfig, ReviewResult, ReviewStage } from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import {
  formatReviewMarkdown,
  parseReviewMarkdown
} from '@shared/review-artifacts'
import { parsePlotBreakdownMarkdown } from '@shared/plot-breakdown'
import {
  captureReviewProvenance,
  isReviewCurrent
} from '../engine/artifact-provenance'
import {
  appendGeneratedStoryToProjectPlotBreakdown,
  markProjectPlotBreakdownEpisodeStatus,
  readPlotBreakdown
} from '../project/plot-breakdown-store'
import { WorkflowEngine, type WorkflowEngineContext } from './workflow-engine'
import type { ILLMProvider } from '../llm/types'

const { reviewContent, reviewProduction, loadSkill } = vi.hoisted(() => ({
  reviewContent: vi.fn(),
  reviewProduction: vi.fn(),
  loadSkill: vi.fn()
}))
vi.mock('../engine/skill-loader', () => ({
  SkillLoader: class {
    load = loadSkill
  }
}))
vi.mock('../engine/review-engine', () => ({
  ReviewEngine: class {
    setProvider = vi.fn()
    reviewContent = reviewContent
    review = reviewProduction
  }
}))

const ART =
  '# 人物提示词\n\n## 林舟\n\n灰色外套，成年男子。\n\n# 场景道具提示词\n\n## 院子\n\n白日院落，木门。\n'
const VALID_SCRIPT = [
  '※ 场景1 院子 日',
  ...Array.from(
    { length: 9 },
    (_, index) => `Seedance P${String(index + 1).padStart(2, '0')}`
  ),
  ...Array.from({ length: 25 }, (_, index) => `△ 动作${index + 1}，推进冲突。`),
  '※ 场景2 大厅 日',
  '※ 场景3 街道 夜',
  ...Array.from({ length: 15 }, (_, index) => `林舟：第${index + 1}句对白。`),
  '【卡黑】'
].join('\n')

function result(stage: ReviewStage, score = 8, passed = true): ReviewResult {
  return {
    stage,
    reviewType: 'business',
    result: passed ? 'PASS' : 'FAIL',
    passed,
    score,
    feedback: passed ? '通过' : '需要修改',
    issues: [],
    createdAt: '2026-06-01T00:00:00Z'
  }
}

let root: string
let config: ProjectConfig
let ctx: WorkflowEngineContext
let engine: WorkflowEngine
let generate: Mock<ILLMProvider['generate']>
function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function episode(
  artifact: Parameters<typeof resolveEpisodeArtifactPath>[1],
  number = 1
): string {
  return resolveEpisodeArtifactPath(root, artifact, number, config)
}
function project(
  artifact: Parameters<typeof resolveProjectArtifactPath>[1]
): string {
  return resolveProjectArtifactPath(root, artifact, config)
}
function approve(stage: ReviewStage): ReviewResult {
  const review = {
    ...result(stage),
    ...captureReviewProvenance(root, stage, 1, config)
  }
  if (stage === 'script_review')
    put(episode('scriptReview'), formatReviewMarkdown('剧本审核', review))
  else {
    const path = project('pipelineState')
    const state = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : { episodes: { 1: { stageStates: {} } } }
    state.episodes[1].stageStates[stage] = {
      status: 'passed',
      lastReview: review
    }
    put(path, JSON.stringify(state))
  }
  return review
}
function productionInputs(): void {
  put(episode('script'), VALID_SCRIPT)
  put(episode('directorAnalysis'), '# 导演分析\n讲戏内容')
  put(episode('artDesign'), ART)
  approve('script_review')
  approve('director')
  approve('art')
}

beforeEach(() => {
  vi.clearAllMocks()
  root = realpathSync(mkdtempSync(join(tmpdir(), 'workflow-behavior-')))
  config = {
    projectName: '测试项目',
    totalEpisodes: 6,
    chaptersPerEpisode: 3,
    visualStyle: '写实',
    targetMedium: '短剧',
    createdAt: '2026-06-01',
    directories: {
      storyDir: 'beats',
      sourceDir: 'source-text',
      assetsDir: 'library',
      outputsDir: 'delivery',
      scriptDir: 'scripts',
      reviewsDir: 'qa'
    },
    pipelineSettings: {
      passScore: 7,
      llmTimeoutSec: 12,
      scriptWordCountMin: 1,
      scriptWordCountMax: 5000
    }
  }
  ctx = {
    projectPath: root,
    episodeNum: 1,
    projectConfig: config,
    projectContext: {
      projectName: '测试项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      episodeNumber: 1
    }
  }
  put(project('sourceNovel'), '# 小说原文\n林舟走进院子，发现木门紧锁。')
  put(
    project('plotBreakdown'),
    '# 剧情拆解\n\n## 剧情列表\n\n### 第1批（第1-6章）\n\n【剧情1】林舟走进院子，第1集，状态：未用\n'
  )
  loadSkill.mockResolvedValue({
    systemPrompt: '规则',
    templates: {},
    examples: {},
    guides: {}
  })
  reviewContent.mockImplementation(async ({ stage }) => result(stage))
  reviewProduction.mockImplementation(async (stage) => result(stage))
  generate = vi.fn().mockResolvedValue('生成内容')
  engine = new WorkflowEngine('/unused/skills')
  engine.setProvider({ generate, generateStream: vi.fn() } as never)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('workflow-engine behavior', () => {
  it('空白生成不覆盖旧产物，也不会发布全局素材', async () => {
    put(episode('script'), '旧剧本')
    generate.mockResolvedValue(' \n ')
    await expect(engine.generateStage('script', ctx)).rejects.toThrow('空白')
    expect(readFileSync(episode('script'), 'utf8')).toBe('旧剧本')
    expect(existsSync(project('characterPrompts'))).toBe(false)
  })

  it('非流式调用消费同一signal和配置超时，晚到取消结果不落盘', async () => {
    const controller = new AbortController()
    generate.mockImplementation(async () => {
      controller.abort(new Error('用户停止'))
      return '晚到结果'
    })
    await expect(
      engine.generateStage('script', { ...ctx, signal: controller.signal })
    ).rejects.toThrow('用户停止')
    expect(generate.mock.calls[0][1]).toMatchObject({
      signal: controller.signal,
      timeoutMs: 12000,
      idleTimeoutMs: 12000,
      firstChunkTimeoutMs: 12000
    })
    expect(existsSync(episode('script'))).toBe(false)
  })

  it('流式生成按迭代内容交付进度并传递超时signal', async () => {
    const controller = new AbortController()
    const generateStream = vi.fn<ILLMProvider['generateStream']>(
      async function* () {
        yield '第一段'
        yield '第二段'
      }
    )
    engine.setProvider({ generate, generateStream } as never)
    const onChunk = vi.fn()
    await engine.generateStage('script', ctx, {
      signal: controller.signal,
      timeoutMs: 333,
      onChunk
    })
    expect(readFileSync(episode('script'), 'utf8')).toBe('第一段第二段')
    expect(onChunk.mock.calls).toEqual([
      ['第一段', 3],
      ['第二段', 6]
    ])
    expect(generateStream.mock.calls[0][1]).toMatchObject({
      signal: controller.signal,
      timeoutMs: 333
    })
  })

  it('暂停等待门保留协程，恢复前不调用模型', async () => {
    const { promise: gate, resolve: resume } = Promise.withResolvers<void>()
    const run = engine.generateStage('script', {
      ...ctx,
      waitUntilResumed: () => gate
    })
    await Promise.resolve()
    expect(generate).not.toHaveBeenCalled()
    resume()
    await run
    expect(readFileSync(episode('script'), 'utf8')).toBe('生成内容')
  })

  it('暂停中取消无需等待恢复，旧协程及时settle且不写文件', async () => {
    const controller = new AbortController()
    const { promise: gate } = Promise.withResolvers<void>()
    const run = engine.generateStage('script', {
      ...ctx,
      signal: controller.signal,
      waitUntilResumed: () => gate
    })
    controller.abort(new Error('停止暂停任务'))
    await expect(run).rejects.toThrow('停止暂停任务')
    expect(generate).not.toHaveBeenCalled()
    expect(existsSync(episode('script'))).toBe(false)
  })

  it('生成调用开始后provider和项目阈值变更不会污染当前执行上下文', async () => {
    const { promise: gate, resolve: resume } = Promise.withResolvers<void>()
    const laterProvider = {
      generate: vi.fn().mockResolvedValue('错误provider结果'),
      generateStream: vi.fn()
    }
    const run = engine.generateStage('script', {
      ...ctx,
      waitUntilResumed: () => gate
    })
    engine.setProvider(laterProvider as never)
    config.pipelineSettings!.llmTimeoutSec = 99
    resume()
    await run
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][1]?.timeoutMs).toBe(12000)
    expect(laterProvider.generate).not.toHaveBeenCalled()
  })

  it('审核透传同一signal；模型返回后取消不持久化或消费库存', async () => {
    const controller = new AbortController()
    put(episode('script'), VALID_SCRIPT)
    reviewContent.mockImplementation(async () => {
      controller.abort(new Error('停止审核'))
      return result('script_review')
    })
    await expect(
      engine.reviewStage('script_review', { ...ctx, signal: controller.signal })
    ).rejects.toThrow('停止审核')
    expect(reviewContent.mock.calls[0][0].signal).toBe(controller.signal)
    expect(existsSync(episode('scriptReview'))).toBe(false)
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches[0]
        .entries[0].status
    ).toBe('未用')
  })

  it('本集重写可以继续使用已消费的绑定剧情', async () => {
    markProjectPlotBreakdownEpisodeStatus({
      projectPath: root,
      config,
      episodeNum: 1,
      toStatus: '已用'
    })
    await engine.generateStage('script', ctx)
    expect(generate.mock.calls[0][0].user).toContain('林舟走进院子')
    expect(generate.mock.calls[0][0].user).toContain('状态：已用')
  })

  it('剧情批次默认水位独立于目标ep，审核保留草稿batch身份', async () => {
    for (let index = 1; index <= 18; index++)
      put(
        join(
          root,
          'source-text',
          'chapters',
          `chapter-${String(index).padStart(3, '0')}.md`
        ),
        `第${index}章\n剧情${index}`
      )
    generate.mockResolvedValue('【剧情1】第七章的新剧情，第4集，状态：未用')
    const target = { ...ctx, episodeNum: 4 }
    const generated = await engine.generateStage('story', target)
    expect(generated.content).toContain('feicai-story-batch:2')
    expect(generate.mock.calls[0][0].user).toContain('章节范围：7-12')
    expect(generate.mock.calls[0][0].user).not.toContain('章节范围：19-24')
    const reviewed = await engine.reviewStage('story_review', target)
    expect(reviewed.review.passed).toBe(true)
    expect(isReviewCurrent(reviewed.review, root, 4, config)).toBe(true)
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches[1]
        .heading
    ).toContain('第2批')
    await expect(
      engine.reviewStage('story_review', { ...target, batchNumber: 3 })
    ).rejects.toThrow('批次')
  })

  it('重复通过同批草稿审核幂等，保留稳定ID、序号和消费状态', async () => {
    put(
      episode('storyBeat'),
      '<!-- feicai-story-batch:1 -->\n【剧情1】林舟走进院子，第1集，状态：未用'
    )
    const first = await engine.reviewStage('story_review', ctx)
    markProjectPlotBreakdownEpisodeStatus({
      projectPath: root,
      config,
      episodeNum: 1,
      toStatus: '已用'
    })
    const before = readPlotBreakdown({ projectPath: root, config }).document
      .batches[0].entries[0]
    await engine.reviewStage('story_review', ctx)
    const after = readPlotBreakdown({ projectPath: root, config }).document
      .batches[0].entries[0]
    expect(after).toMatchObject({
      id: before.id,
      index: before.index,
      status: '已用'
    })
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches
    ).toHaveLength(1)
    expect(isReviewCurrent(first.review, root, 1, config)).toBe(true)
  })

  it.each([
    '说明而无剧情点',
    '【剧情1】，第1集，状态：未用',
    '【剧情1】剧情没有集数，状态：未用',
    '【剧情1】剧情，第99集，状态：未用'
  ])('拒绝无法绑定库存的结构输出：%s', async (content) => {
    generate.mockResolvedValue(content)
    await expect(engine.generateStage('story', ctx)).rejects.toThrow()
    expect(existsSync(episode('storyBeat'))).toBe(false)
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches
    ).toHaveLength(1)
  })

  it('未绑定批次的历史草稿不能冒用目标ep进行审核', async () => {
    put(episode('storyBeat'), '【剧情1】院子，第1集，状态：未用')
    await expect(engine.reviewStage('story_review', ctx)).rejects.toThrow(
      '批次身份'
    )
    expect(reviewContent).not.toHaveBeenCalled()
  })

  it('所有独立入口使用项目阈值；低于阈值FAIL落盘但不消费库存', async () => {
    config.pipelineSettings!.passScore = 9
    put(episode('script'), VALID_SCRIPT)
    const reviewed = await engine.reviewStage('script_review', ctx)
    expect(reviewed.review.passed).toBe(false)
    expect(reviewContent.mock.calls[0][0]).toMatchObject({
      passScore: 9,
      timeoutMs: 12000
    })
    expect(
      parseReviewMarkdown(
        readFileSync(episode('scriptReview'), 'utf8'),
        'script_review'
      )?.result
    ).toBe('FAIL')
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches[0]
        .entries[0].status
    ).toBe('未用')
  })

  it('生成和审核操作标记与正文一同落盘，保持卡黑与provenance有效', async () => {
    generate.mockResolvedValue(VALID_SCRIPT)
    const generated = await engine.generateStage('script', {
      ...ctx,
      operationId: 'generate-operation-1'
    })
    const script = readFileSync(episode('script'), 'utf8')
    expect(script).toBe(generated.content)
    expect(
      script.startsWith('<!-- feicai-operation:generate-operation-1 -->\n')
    ).toBe(true)
    expect(script.trimEnd().endsWith('【卡黑】')).toBe(true)
    const reviewed = await engine.reviewStage('script_review', {
      ...ctx,
      operationId: 'review-operation-2'
    })
    const reviewFile = readFileSync(episode('scriptReview'), 'utf8')
    expect(reviewFile).toContain('<!-- feicai-operation:review-operation-2 -->')
    expect(parseReviewMarkdown(reviewFile, 'script_review')?.passed).toBe(true)
    expect(reviewed.review.passed).toBe(true)
    expect(isReviewCurrent(reviewed.review, root, 1, config)).toBe(true)
  })

  it('当前剧审PASS消费剧情后依然current，director入口接受；剧本变更立即拒绝', async () => {
    put(episode('script'), VALID_SCRIPT)
    const reviewed = await engine.reviewStage('script_review', ctx)
    expect(reviewed.review.passed).toBe(true)
    expect(isReviewCurrent(reviewed.review, root, 1, config)).toBe(true)
    await engine.generateStage('director', ctx)
    put(episode('script'), VALID_SCRIPT + '\n改动')
    await expect(engine.generateStage('director', ctx)).rejects.toThrow(
      'script_review'
    )
    await expect(engine.reviewStage('director', ctx)).rejects.toThrow(
      'script_review'
    )
  })

  it('art和storyboard都要求当前有效上游审核，旧PASS不能绕过', async () => {
    productionInputs()
    put(episode('directorAnalysis'), '# 已修改导演分析')
    await expect(engine.generateStage('art', ctx)).rejects.toThrow('director')
    await expect(engine.reviewStage('art', ctx)).rejects.toThrow('director')
    approve('director')
    approve('art')
    put(episode('artDesign'), ART + '\n改变服装')
    await expect(engine.generateStage('storyboard', ctx)).rejects.toThrow('art')
    await expect(engine.reviewStage('storyboard_review', ctx)).rejects.toThrow(
      'art'
    )
  })

  it('审核中依赖变化不保存审核或消费剧情', async () => {
    put(episode('script'), VALID_SCRIPT)
    reviewContent.mockImplementation(async () => {
      put(episode('script'), '审核期间被改')
      return result('script_review')
    })
    await expect(engine.reviewStage('script_review', ctx)).rejects.toThrow(
      '已改变'
    )
    expect(existsSync(episode('scriptReview'))).toBe(false)
    expect(
      readPlotBreakdown({ projectPath: root, config }).document.batches[0]
        .entries[0].status
    ).toBe('未用')
  })

  it('服化道草稿和FAIL不污染全局，PASS按自定义目录幂等发布', async () => {
    productionInputs()
    generate.mockResolvedValue(ART)
    await engine.generateStage('art', ctx)
    expect(existsSync(project('characterPrompts'))).toBe(false)
    reviewProduction.mockResolvedValueOnce(result('art', 5, false))
    await engine.reviewStage('art', ctx)
    expect(existsSync(project('characterPrompts'))).toBe(false)
    const approved = await engine.reviewStage('art', ctx)
    await engine.reviewStage('art', ctx)
    expect(
      readFileSync(project('characterPrompts'), 'utf8').match(/^## 林舟$/gm)
    ).toHaveLength(1)
    expect(
      readFileSync(project('scenePrompts'), 'utf8').match(/^## 院子$/gm)
    ).toHaveLength(1)
    expect(existsSync(join(root, 'assets'))).toBe(false)
    expect(isReviewCurrent(approved.review, root, 1, config)).toBe(true)
  })

  it('分镜审核实际读取并对照本集服化道正文', async () => {
    productionInputs()
    put(episode('seedancePrompts'), '# Seedance 提示词')
    const reviewed = await engine.reviewStage('storyboard_review', ctx)
    expect(reviewContent.mock.calls[0][0].artDesign).toBe(ART)
    expect(isReviewCurrent(reviewed.review, root, 1, config)).toBe(true)
  })

  it('链接目录无法把产物写出项目安全边界', async () => {
    const external = realpathSync(
      mkdtempSync(join(tmpdir(), 'workflow-external-'))
    )
    try {
      symlinkSync(external, join(root, 'scripts'))
      await expect(engine.generateStage('script', ctx)).rejects.toThrow('链接')
      expect(generate).not.toHaveBeenCalled()
      expect(existsSync(join(external, 'ep01.md'))).toBe(false)
    } finally {
      rmSync(external, { recursive: true, force: true })
    }
  })

  it('库存发布空输出直接失败，不返回0追加成功', () => {
    expect(() =>
      appendGeneratedStoryToProjectPlotBreakdown({
        projectPath: root,
        config,
        batchNumber: 2,
        generatedContent: ''
      })
    ).toThrow()
    expect(
      parsePlotBreakdownMarkdown(readFileSync(project('plotBreakdown'), 'utf8'))
        .batches
    ).toHaveLength(1)
  })
})
