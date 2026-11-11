import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { ReviewEngine } from './review-engine'
import { PromptAssembler } from './prompt-assembler'
import { isReviewCurrent } from './artifact-provenance'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import type { Skill } from '@shared/types'

const pass = JSON.stringify({
  result: 'PASS',
  score: 8.5,
  feedback: '逐项核验通过',
  issues: []
})
const fail = JSON.stringify({
  result: 'FAIL',
  score: 5,
  feedback: '存在问题',
  issues: [
    {
      severity: 'major',
      description: '核心冲突不足',
      location: '中段',
      suggestion: '补足对抗'
    }
  ]
})
const skill: Skill = {
  name: 'review',
  description: '',
  systemPrompt: '逐项核验',
  templates: {},
  examples: {},
  skillPath: '',
  fileManifest: []
}

let projectPath: string
function writeArtifact(id: EpisodeArtifactId, content: string): void {
  const path = resolveEpisodeArtifactPath(projectPath, id, 1)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createEngine() {
  const load = vi.fn().mockResolvedValue(skill)
  const generate = vi.fn().mockResolvedValue(pass)
  const engine = new ReviewEngine({ load } as never, new PromptAssembler())
  engine.setProvider({ generate } as never)
  return { engine, load, generate }
}

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'feicai-review-engine-'))
  writeArtifact('script', '# 剧本\n【卡黑】')
  writeArtifact('directorAnalysis', '# 导演')
  writeArtifact('artDesign', '# 服化道')
  writeArtifact('seedancePrompts', '# 提示词')
  const source = resolveProjectArtifactPath(projectPath, 'sourceNovel')
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, '# 原文')
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(projectPath, { recursive: true, force: true })
})

describe('ReviewEngine', () => {
  it('使用真实解析器合并两步审核，合规未通过阻断最终通过', async () => {
    const { engine, generate } = createEngine()
    generate.mockResolvedValueOnce(pass).mockResolvedValueOnce(fail)
    const result = await engine.reviewContent({
      stage: 'script_review',
      reviewSkillName: 'script-review-skill',
      outputToReview: '# 剧本'
    })
    expect(result).toMatchObject({ result: 'FAIL', passed: false, score: 8.5 })
    expect(result.issues[0].location).toBe('中段')
    expect(result.feedback).toContain('## 合规审核: ❌ FAIL')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it.each([0, 1])('任一步输出无效都保留 INVALID（第%s步）', async (step) => {
    const { engine, generate } = createEngine()
    generate
      .mockResolvedValueOnce(step === 0 ? '看起来很好' : pass)
      .mockResolvedValueOnce(step === 1 ? 'FAIL' : pass)
    expect(
      await engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '# 剧本'
      })
    ).toMatchObject({ result: 'INVALID', passed: false })
  })

  it('业务请求失败不加载或启动合规请求', async () => {
    const { engine, generate, load } = createEngine()
    generate.mockRejectedValueOnce(new Error('provider rejected'))
    await expect(
      engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '# 剧本'
      })
    ).rejects.toThrow('provider rejected')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('预取消不调用模型，业务审核中取消也不启动第二步', async () => {
    const { engine, generate } = createEngine()
    const cancelled = new AbortController()
    cancelled.abort(new Error('停止'))
    await expect(
      engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '# 剧本',
        signal: cancelled.signal
      })
    ).rejects.toThrow('停止')
    expect(generate).not.toHaveBeenCalled()
    const active = new AbortController()
    generate.mockImplementationOnce(async (_prompt, options) => {
      active.abort(new Error('中断'))
      expect(options.signal.aborted).toBe(true)
      return pass
    })
    await expect(
      engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '# 剧本',
        signal: active.signal
      })
    ).rejects.toThrow('中断')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('共享总超时会中止挂起模型，且不再启动合规', async () => {
    vi.useFakeTimers()
    const { engine, generate } = createEngine()
    generate.mockReturnValueOnce(Promise.withResolvers<string>().promise)
    const promise = engine.reviewContent({
      stage: 'script_review',
      reviewSkillName: 'script-review-skill',
      outputToReview: '# 剧本',
      timeoutMs: 50
    })
    const rejection = expect(promise).rejects.toThrow('审核超时')
    await vi.advanceTimersByTimeAsync(51)
    await rejection
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][1].signal.aborted).toBe(true)
    expect(generate.mock.calls[0][1].timeoutMs).toBeLessThanOrEqual(50)
  })

  it('逐调用 provider/阈值不被共享 setter 的后续改变污染', async () => {
    const { engine, generate } = createEngine()
    const replacement = vi.fn().mockResolvedValue(fail)
    generate.mockImplementationOnce(async () => {
      engine.setProvider({ generate: replacement } as never)
      engine.setPassScore(10)
      return pass
    })
    const result = await engine.reviewContent({
      stage: 'script_review',
      reviewSkillName: 'script-review-skill',
      outputToReview: '# 剧本',
      passScore: 8
    })
    expect(result.result).toBe('PASS')
    expect(generate).toHaveBeenCalledTimes(2)
    expect(replacement).not.toHaveBeenCalled()
  })

  it('文件路径审核附带本集服化道、正文与依赖来源绑定', async () => {
    const { engine, generate } = createEngine()
    const result = await engine.review('storyboard', {
      projectPath,
      episodeNum: 1
    })
    expect(result.result).toBe('PASS')
    expect(result.artifactHash).toMatch(/^[a-f0-9]{64}$/)
    expect(isReviewCurrent(result, projectPath, 1)).toBe(true)
    expect(generate.mock.calls[0][0].user).toContain('# 服化道')
    writeArtifact('artDesign', '# 修改后的服化道')
    expect(isReviewCurrent(result, projectPath, 1)).toBe(false)
  })

  it.each([
    'seedancePrompts',
    'script',
    'directorAnalysis',
    'artDesign'
  ] as const)(
    '审核执行期间%s发生变化，不能产出可提交PASS',
    async (artifact) => {
      const { engine, generate } = createEngine()
      generate.mockImplementationOnce(async () => {
        writeArtifact(artifact, '# 已修改')
        return pass
      })
      await expect(
        engine.review('storyboard', { projectPath, episodeNum: 1 })
      ).rejects.toThrow('审核期间正文或上游材料已变化')
    }
  )

  it('显式正文与磁盘不一致时，在模型请求前拒绝审核', async () => {
    const { engine, generate } = createEngine()
    await expect(
      engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '旧正文',
        projectPath,
        episodeNum: 1
      })
    ).rejects.toThrow('待审正文与当前文件不一致')
    expect(generate).not.toHaveBeenCalled()
  })

  it.each(['resume', 'cancel'] as const)(
    '合规模型前等待暂停门：%s',
    async (action) => {
      const { engine, generate } = createEngine()
      const blocked = Promise.withResolvers<void>()
      const resumed = Promise.withResolvers<void>()
      const controller = new AbortController()
      const waitUntilResumed = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => {
          blocked.resolve()
          return resumed.promise
        })
      const promise = engine.reviewContent({
        stage: 'script_review',
        reviewSkillName: 'script-review-skill',
        outputToReview: '# 正文',
        signal: controller.signal,
        waitUntilResumed
      })
      await blocked.promise
      expect(generate).toHaveBeenCalledTimes(1)
      if (action === 'cancel') {
        controller.abort(new Error('暂停中取消'))
        await expect(promise).rejects.toThrow('暂停中取消')
        expect(generate).toHaveBeenCalledTimes(1)
        resumed.resolve()
      } else {
        resumed.resolve()
        expect((await promise).result).toBe('PASS')
        expect(generate).toHaveBeenCalledTimes(2)
        expect(generate.mock.calls[0][1].signal).toBe(
          generate.mock.calls[1][1].signal
        )
      }
    }
  )
})
