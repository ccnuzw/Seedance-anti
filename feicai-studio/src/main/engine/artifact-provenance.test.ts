import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { captureReviewProvenance, isReviewCurrent } from './artifact-provenance'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import type { ProjectConfig, ReviewResult, ReviewStage } from '@shared/types'

let projectPath: string
const config: Partial<ProjectConfig> = {
  chaptersPerEpisode: 2,
  totalEpisodes: 6
}
function writeEpisode(
  id: EpisodeArtifactId,
  content: string,
  episode = 1
): void {
  const path = resolveEpisodeArtifactPath(projectPath, id, episode, config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function writeInventory(
  status = '未用',
  first = '主角反击',
  other = '旁支'
): void {
  const path = resolveProjectArtifactPath(projectPath, 'plotBreakdown', config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `# 剧情库存\n\n## 剧情列表\n\n### 第1批（第1-6章）\n【剧情1】${first}，第1集，状态：${status}\n【剧情2】${other}，第2集，状态：未用\n`
  )
}
function boundReview(stage: ReviewStage, episode = 1): ReviewResult {
  return {
    stage,
    result: 'PASS',
    passed: true,
    score: 9,
    reviewType: 'business',
    feedback: '已核验',
    issues: [],
    createdAt: '2026-11-12T00:00:00Z',
    ...captureReviewProvenance(projectPath, stage, episode, config)
  }
}

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'feicai-provenance-'))
  writeEpisode(
    'storyBeat',
    '<!-- feicai-story-batch:1 -->\n【剧情1】主角反击，第1集，状态：未用'
  )
  writeEpisode('script', '# 本集剧本')
  writeEpisode('scriptReview', '# 本集剧审')
  writeEpisode('directorAnalysis', '# 导演讲戏本')
  writeEpisode('artDesign', '# 本集服化道')
  writeEpisode('seedancePrompts', '# 视频提示词')
  writeInventory()
  mkdirSync(join(projectPath, 'source', 'chapters'), { recursive: true })
  for (let chapter = 1; chapter <= 12; chapter++) {
    writeFileSync(
      join(
        projectPath,
        'source',
        'chapters',
        `chapter-${String(chapter).padStart(3, '0')}.md`
      ),
      `# 第${chapter}章\n章节正文${chapter}`
    )
  }
})
afterEach(() => rmSync(projectPath, { recursive: true, force: true }))

describe('artifact provenance', () => {
  it('依赖schema升级后旧凭据即使正文未变也保守失效', () => {
    const review = boundReview('art')
    delete review.inputHashes!.dependencySchema
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
  })

  it('角色输入只使视觉审核失效；相邻剧本变化使剧审及后续凭据失效', () => {
    const script = boundReview('script_review')
    const director = boundReview('director')
    const art = boundReview('art')
    const storyboard = boundReview('storyboard_review')
    writeEpisode('characterDesign', '# 红衣角色')
    expect(isReviewCurrent(script, projectPath, 1, config)).toBe(true)
    expect(isReviewCurrent(director, projectPath, 1, config)).toBe(true)
    expect(isReviewCurrent(art, projectPath, 1, config)).toBe(false)
    expect(isReviewCurrent(storyboard, projectPath, 1, config)).toBe(false)
    writeEpisode('script', '# 新的下一集', 2)
    expect(isReviewCurrent(script, projectPath, 1, config)).toBe(false)
    expect(isReviewCurrent(director, projectPath, 1, config)).toBe(false)
  })
  it.each([
    'story_review',
    'script_review',
    'director',
    'art',
    'storyboard_review'
  ] as const)('绑定%s正文，正文变化即失效', (stage) => {
    const artifact: Record<ReviewStage, EpisodeArtifactId> = {
      story_review: 'storyBeat',
      script_review: 'script',
      director: 'directorAnalysis',
      art: 'artDesign',
      storyboard_review: 'seedancePrompts'
    }
    const review = boundReview(stage)
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(true)
    writeEpisode(artifact[stage], '# 修改后的正文')
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
  })

  it('未绑定legacy、INVALID、矛盾passed与越界分数均不能当作当前PASS', () => {
    const review = boundReview('script_review')
    for (const update of [
      { artifactHash: undefined },
      { inputHashes: undefined },
      { inputHashes: {} },
      { result: 'INVALID' as const },
      { result: 'FAIL' as const },
      { passed: false },
      { score: Infinity },
      { score: 11 },
      { score: -1 },
      { score: 6 }
    ])
      expect(
        isReviewCurrent({ ...review, ...update }, projectPath, 1, config)
      ).toBe(false)
  })

  it('库存消费/无关集剧情/发布资产/新批次草稿不会使已审本集剧本失效', () => {
    const review = boundReview('script_review')
    writeInventory('已用', '主角反击', '另一集已调整')
    writeEpisode('storyBeat', '<!-- feicai-story-batch:2 -->\n全新库存批次')
    const asset = resolveProjectArtifactPath(
      projectPath,
      'characterPrompts',
      config
    )
    mkdirSync(dirname(asset), { recursive: true })
    writeFileSync(asset, '# 发布的新角色')
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(true)
    writeInventory('已用', '本集核心冲突已改变')
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
  })

  it('只绑定相关章节，但相关章节变化会逐级使生产审核失效', () => {
    const review = boundReview('storyboard_review')
    writeFileSync(
      join(projectPath, 'source', 'chapters', 'chapter-012.md'),
      '# 无关章节修改'
    )
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(true)
    writeFileSync(
      join(projectPath, 'source', 'chapters', 'chapter-002.md'),
      '# 本集章节修改'
    )
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
  })

  it('独立批次标记而不是目标集数决定story审核的6章窗口', () => {
    writeEpisode('storyBeat', '<!-- feicai-story-batch:2 -->\n第二批草稿', 4)
    const review = boundReview('story_review', 4)
    writeFileSync(
      join(projectPath, 'source', 'chapters', 'chapter-001.md'),
      '# 第一批变更'
    )
    expect(isReviewCurrent(review, projectPath, 4, config)).toBe(true)
    writeFileSync(
      join(projectPath, 'source', 'chapters', 'chapter-007.md'),
      '# 第二批变更'
    )
    expect(isReviewCurrent(review, projectPath, 4, config)).toBe(false)
  })

  it('没有可核验批次身份的旧story草稿不能绑定', () => {
    writeEpisode('storyBeat', '# 旧草稿')
    expect(() =>
      captureReviewProvenance(projectPath, 'story_review', 1, config)
    ).toThrow('缺少批次身份')
  })

  it.each(['script', 'scriptReview', 'directorAnalysis', 'artDesign'] as const)(
    '生产审核绑定上游%s',
    (artifact) => {
      const review = boundReview('storyboard_review')
      writeEpisode(artifact, '# 上游已更新')
      expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
    }
  )

  it('相关依赖被删除或审核阶段/集数被篡改时保守失效', () => {
    const review = boundReview('art')
    rmSync(
      resolveEpisodeArtifactPath(projectPath, 'directorAnalysis', 1, config)
    )
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
    expect(isReviewCurrent(review, projectPath, 0, config)).toBe(false)
    expect(
      isReviewCurrent(
        { ...review, stage: 'unknown' as ReviewStage },
        projectPath,
        1,
        config
      )
    ).toBe(false)
  })

  it('相同正文重试只改变operation标记，不会使正文或上游审核失效', () => {
    writeEpisode('seedancePrompts', '<!-- feicai-operation:first -->\n# 提示词')
    writeEpisode('artDesign', '<!-- feicai-operation:first -->\n# 服化道')
    writeEpisode('scriptReview', '# 剧审\n<!-- feicai-operation:first -->')
    const review = boundReview('storyboard_review')
    writeEpisode('seedancePrompts', '<!-- feicai-operation:retry -->\n# 提示词')
    writeEpisode('artDesign', '<!-- feicai-operation:retry -->\n# 服化道')
    writeEpisode('scriptReview', '# 剧审\n<!-- feicai-operation:retry -->')
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(true)
    writeEpisode(
      'seedancePrompts',
      '<!-- feicai-operation:retry -->\n# 实际正文变化'
    )
    expect(isReviewCurrent(review, projectPath, 1, config)).toBe(false)
  })
})
