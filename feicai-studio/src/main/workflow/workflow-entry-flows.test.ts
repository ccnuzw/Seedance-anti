import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type {
  ProjectConfig,
  ProjectEntryStage,
  ReviewResult
} from '@shared/types'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { parseReviewMarkdown } from '@shared/review-artifacts'
import { isReviewCurrent } from '../engine/artifact-provenance'
import { WorkflowEngine, type WorkflowEngineContext } from './workflow-engine'

const script = [
  '※ 场景1 院子 日',
  ...Array.from(
    { length: 9 },
    (_, i) => `Seedance P${String(i + 1).padStart(2, '0')}`
  ),
  ...Array.from({ length: 25 }, (_, i) => `△ 动作${i + 1}，推进冲突。`),
  '※ 场景2 大厅 日',
  '※ 场景3 街道 夜',
  ...Array.from({ length: 15 }, (_, i) => `林舟：第${i + 1}句对白。`),
  '【卡黑】'
].join('\n')
const art =
  '# 人物提示词\n\n## 林舟\n\n灰色外套。\n\n# 场景道具提示词\n\n## 院子\n\n白日院落。'
const pass = JSON.stringify({
  result: 'PASS',
  score: 9,
  feedback: '逐项核验通过',
  issues: []
})
const fail = JSON.stringify({
  result: 'FAIL',
  score: 5,
  feedback: '未通过',
  issues: []
})
let root: string
let config: ProjectConfig
let engine: WorkflowEngine
let ctx: WorkflowEngineContext
const generate = vi.fn()
function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
const episode = (
  artifact: Parameters<typeof resolveEpisodeArtifactPath>[1],
  n = 1
) => resolveEpisodeArtifactPath(root, artifact, n, config)
const project = (artifact: Parameters<typeof resolveProjectArtifactPath>[1]) =>
  resolveProjectArtifactPath(root, artifact, config)
function persist(review: ReviewResult): void {
  const path = project('pipelineState')
  const state = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { episodes: { 1: { stageStates: {} } } }
  state.episodes[1].stageStates[review.stage] = {
    status: 'passed',
    lastReview: review
  }
  put(path, JSON.stringify(state))
}
async function review(
  stage: Parameters<WorkflowEngine['reviewStage']>[0]
): Promise<ReviewResult> {
  generate.mockResolvedValue(pass)
  const before = generate.mock.calls.length
  const result = (await engine.reviewStage(stage, ctx)).review
  expect(generate.mock.calls.length - before).toBe(2)
  for (const [prompt] of generate.mock.calls.slice(before)) {
    expect(prompt.system).toContain(`${config.entryStage}（`)
    expect(prompt.system).toContain('业务及合规双审核、评分阈值')
    expect(prompt.system.indexOf('# 项目入口适用范围')).toBeGreaterThan(
      prompt.system.indexOf('# 审核规范')
    )
    expect(prompt.user).toContain('待审核内容')
    if (config.entryStage !== 'novel') {
      expect(prompt.system).toContain('不得仅因不存在这些来源判定失败')
      expect(prompt.user).not.toContain('# 小说原文与设定')
    }
  }
  expect(result.passed).toBe(true)
  expect(isReviewCurrent(result, root, 1, config)).toBe(true)
  if (stage === 'director' || stage === 'art') persist(result)
  return result
}
async function create(
  stage: Parameters<WorkflowEngine['generateStage']>[0],
  content: string
): Promise<void> {
  generate.mockResolvedValueOnce(content)
  await engine.generateStage(stage, ctx)
  const prompt = generate.mock.calls.at(-1)![0]
  expect(prompt.system).toContain(`${config.entryStage}（`)
  if (stage === 'story' && config.entryStage === 'novel') {
    for (const principle of [
      '每个剧情点都必须能对应当前批次原文中的具体事件证据',
      '不得仅凭沉默、表情、停顿或镜头切换断定角色的动机',
      '明确为未成年人的角色不得被性化',
      '明确标记阻塞并交由既有严格合规审核'
    ]) {
      expect(prompt.system).toContain(principle)
    }
    for (const principle of [
      '每个剧情点须能映射到当前批次原文',
      '不得仅凭沉默、表情或停顿推断意图',
      '自尽被阻止、转场或人物醒来不等于重生',
      '明确为未成年人的角色不得性化',
      '源情节无法安全适配时标记阻塞',
      '3-4 个剧情点，但只是建议而非硬指标',
      '明确切集转折'
    ]) {
      expect(prompt.user).toContain(principle)
    }
    expect(prompt.user).toContain('已有最大剧情编号')
  }
}
function entry(stage: ProjectEntryStage): void {
  config.entryStage = stage
}
beforeEach(() => {
  generate.mockReset()
  root = mkdtempSync(join(tmpdir(), 'feicai-entry-flow-'))
  config = {
    projectName: '入口回归',
    entryStage: 'novel',
    totalEpisodes: 3,
    chaptersPerEpisode: 2,
    visualStyle: '写实',
    targetMedium: '短剧',
    createdAt: '2026-01-01',
    pipelineSettings: { scriptWordCountMin: 1, scriptWordCountMax: 5000 }
  }
  ctx = {
    projectPath: root,
    episodeNum: 1,
    projectConfig: config,
    projectContext: {
      projectName: config.projectName,
      visualStyle: '写实',
      targetMedium: '短剧',
      episodeNumber: 1
    }
  }
  engine = new WorkflowEngine(join(process.cwd(), 'resources/builtin-skills'))
  engine.setProvider({ generate, generateStream: vi.fn() } as never)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('three entry flows with real skills, review parser and controlled provider', () => {
  it('first novel batch prompts allow empty inventory while script prompts require bound inventory', async () => {
    put(project('sourceNovel'), '# 原著\n林舟闯入院子，逼问守卫。')
    expect(existsSync(project('plotBreakdown'))).toBe(false)
    await create(
      'story',
      '【剧情1】院落，林舟逼问守卫，反击，第1集，状态：未用'
    )
    expect(existsSync(project('plotBreakdown'))).toBe(false)
    await review('story_review')
    // Inspect the actual generation + business/compliance prompts, including
    // real builtin skills. Fixed provider PASS alone cannot detect conflicts.
    expect(generate.mock.calls).toHaveLength(3)
    for (const [prompt] of generate.mock.calls) {
      const scope = prompt.system.split('# 项目入口适用范围')[1]
      expect(scope).toContain('当前阶段为剧情拆解/批次审核')
      expect(scope).toContain('必须使用当前批次真实小说原文并核验适用批次身份')
      expect(scope).toContain('缺少原文不得生成或通过审核')
      expect(scope).toContain(
        '已有剧情库存可为空，首次拆解不要求现成本集绑定库存'
      )
      expect(scope).toContain('当前草稿只有审核通过后才发布到库存')
      expect(scope).toContain('已有库存存在时必须对照其编号、批次和分集规划')
      expect(scope).not.toContain('剧本生成/剧本审核要求')
      expect(prompt.system).not.toContain(
        '小说章节和本集绑定剧情库存是必需上游'
      )
      expect(prompt.user).toContain('林舟闯入院子，逼问守卫')
    }
    expect(existsSync(project('plotBreakdown'))).toBe(true)
    generate.mockClear()
    await create('script', script)
    await review('script_review')
    expect(generate.mock.calls).toHaveLength(3)
    for (const [prompt] of generate.mock.calls) {
      const scope = prompt.system.split('# 项目入口适用范围')[1]
      expect(scope).toContain(
        '剧本生成/剧本审核要求真实小说章节和本集绑定剧情库存'
      )
      expect(scope).toContain('缺少必需来源不得生成剧本或通过剧审')
      expect(scope).not.toContain('已有剧情库存可为空')
      expect(scope).not.toContain('首次拆解不要求现成本集绑定库存')
      expect(prompt.user).toContain('【剧情1】')
      expect(prompt.user).toContain('林舟闯入院子，逼问守卫')
    }
  })

  it.each(['novel', 'story', 'script'] as const)(
    '%s reaches current storyboard review without inventing upstream artifacts',
    async (stage) => {
      entry(stage)
      if (stage === 'novel') {
        put(project('sourceNovel'), '# 原著\n林舟闯入院子。')
        await create(
          'story',
          '【剧情1】院落，林舟逼问守卫，反击，第1集，状态：未用\n【剧情2】码头，守卫追击林舟，悬念，第2集，状态：未用'
        )
        await review('story_review')
        const inventory = readFileSync(project('plotBreakdown'), 'utf8')
        await review('story_review')
        expect(readFileSync(project('plotBreakdown'), 'utf8')).toBe(inventory)
      } else if (stage === 'story') {
        put(
          episode('storyBeat'),
          '# 人工剧情\n林舟闯入院子，逼问守卫；门外出现追兵，留下悬念。'
        )
        await expect(engine.generateStage('script', ctx)).rejects.toThrow(
          'story_review'
        )
        await review('story_review')
      } else {
        put(episode('script'), script)
      }
      if (stage !== 'script') {
        await create('script', script)
        if (stage === 'story')
          expect(generate.mock.calls.at(-1)![0].user).toContain('人工剧情')
      }
      const scriptReview = await review('script_review')
      if (stage === 'novel') {
        const inventory = readFileSync(project('plotBreakdown'), 'utf8')
        expect(inventory).toContain('状态：已用')
        expect(inventory).toContain('第2集，状态：未用')
        await review('script_review')
        expect(readFileSync(project('plotBreakdown'), 'utf8')).toBe(inventory)
        await create('script', script)
        expect(generate.mock.calls.at(-1)![0].user).toContain('状态：已用')
      }
      await create('director', '# 导演\n开场冲突、节奏递进。')
      const directorReview = await review('director')
      await create('character', '# 角色设计\n林舟左眉有疤，灰色短外套。')
      await create('art', art)
      expect(generate.mock.calls.at(-1)![0].user).toContain('林舟左眉有疤')
      const artReview = await review('art')
      expect(generate.mock.calls.at(-1)![0].user).toContain('林舟左眉有疤')
      expect(isReviewCurrent(scriptReview, root, 1, config)).toBe(true)
      expect(isReviewCurrent(directorReview, root, 1, config)).toBe(true)
      const published = readFileSync(project('characterPrompts'), 'utf8')
      await review('art')
      expect(readFileSync(project('characterPrompts'), 'utf8')).toBe(published)
      await create('storyboard', '# 分镜\nP01 院落对峙。')
      expect(generate.mock.calls.at(-1)![0].user).toContain('林舟左眉有疤')
      expect(generate.mock.calls.at(-1)![0].user).toContain('本集服化道设计')
      const final = await review('storyboard_review')
      const persisted = parseReviewMarkdown(
        readFileSync(episode('storyboardReview'), 'utf8'),
        'storyboard_review'
      )!
      expect(isReviewCurrent(persisted, root, 1, config)).toBe(true)
      if (stage !== 'novel') {
        expect(existsSync(project('sourceNovel'))).toBe(false)
        expect(existsSync(project('plotBreakdown'))).toBe(false)
      }
      if (stage === 'script')
        expect(existsSync(episode('storyBeat'))).toBe(false)
      // Shared assets affect visual work, while art publication leaves earlier gates current.
      put(
        project('characterPrompts'),
        published.replace('灰色外套', '红色外套')
      )
      expect(isReviewCurrent(artReview, root, 1, config)).toBe(false)
      expect(isReviewCurrent(final, root, 1, config)).toBe(false)
      expect(isReviewCurrent(scriptReview, root, 1, config)).toBe(true)
      expect(isReviewCurrent(directorReview, root, 1, config)).toBe(true)
      put(project('characterPrompts'), published)
      expect(isReviewCurrent(artReview, root, 1, config)).toBe(true)
      // Optional character is a real dependency of visual work, never a new gate.
      put(episode('characterDesign'), '# 修改角色设计\n红衣，无疤。')
      expect(isReviewCurrent(artReview, root, 1, config)).toBe(false)
      expect(isReviewCurrent(final, root, 1, config)).toBe(false)
      expect(isReviewCurrent(directorReview, root, 1, config)).toBe(true)
      await expect(engine.generateStage('storyboard', ctx)).rejects.toThrow(
        'art'
      )
    }
  )

  it('script entry remains fail-closed for both reviews and local rules; supports revision', async () => {
    entry('script')
    put(episode('script'), script)
    generate.mockResolvedValueOnce(pass).mockResolvedValueOnce(fail)
    expect((await engine.reviewStage('script_review', ctx)).review.passed).toBe(
      false
    )
    await expect(engine.generateStage('director', ctx)).rejects.toThrow(
      'script_review'
    )
    generate.mockResolvedValue(pass)
    put(episode('script'), '不符合硬规则的短文本')
    expect((await engine.reviewStage('script_review', ctx)).review.passed).toBe(
      false
    )
    await create('script', script)
    expect(generate.mock.calls.at(-1)![0].user).toContain('不符合硬规则')
    await review('script_review')
  })

  it('story edits invalidate script and downstream; a failed story cannot authorize generation', async () => {
    entry('story')
    put(episode('storyBeat'), '人工剧情')
    generate.mockResolvedValueOnce(fail).mockResolvedValueOnce(pass)
    expect((await engine.reviewStage('story_review', ctx)).review.passed).toBe(
      false
    )
    await expect(engine.generateStage('script', ctx)).rejects.toThrow(
      'story_review'
    )
    await review('story_review')
    await create('script', script)
    const approved = await review('script_review')
    put(episode('storyBeat'), '修改后的人工剧情')
    expect(isReviewCurrent(approved, root, 1, config)).toBe(false)
    await expect(engine.reviewStage('script_review', ctx)).rejects.toThrow(
      'story_review'
    )
    await expect(engine.generateStage('director', ctx)).rejects.toThrow(
      'script_review'
    )
  })

  it('novel still requires batch identity, source and inventory', async () => {
    put(episode('storyBeat'), '没有批次的草稿')
    await expect(engine.reviewStage('story_review', ctx)).rejects.toThrow(
      '批次身份'
    )
    put(
      episode('storyBeat'),
      '<!-- feicai-story-batch:1 -->\n【剧情1】反击，第1集，状态：未用'
    )
    await expect(engine.reviewStage('story_review', ctx)).rejects.toThrow(
      '原文章节'
    )
    put(episode('script'), script)
    await expect(engine.reviewStage('script_review', ctx)).rejects.toThrow(
      '绑定剧情点'
    )
    expect(generate).not.toHaveBeenCalled()
  })
})
