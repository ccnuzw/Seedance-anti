import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { PipelineStateMachine } from './state-machine'
import { WorkflowEngine } from '../workflow/workflow-engine'
import { ProductionCommitStore } from '../io/production-commit-store'
import type { ILLMProvider } from '../llm/types'
import type { AutomatedPipelineStage } from '@shared/types'

vi.mock('./skill-loader', () => ({
  SkillLoader: class {
    async load() {
      return { systemPrompt: '规则', templates: {}, examples: {}, guides: {} }
    }
  }
}))
const script = [
  '※ 场景1 院子 日',
  ...Array.from({ length: 9 }, (_, i) => `Seedance P${i + 1}`),
  ...Array.from({ length: 25 }, (_, i) => `△ 动作${i + 1}，推进冲突。`),
  '※ 场景2 大厅 日',
  '※ 场景3 街道 夜',
  ...Array.from({ length: 15 }, (_, i) => `林舟：第${i + 1}句对白。`),
  '【卡黑】'
].join('\n')
const pass = JSON.stringify({
  result: 'PASS',
  score: 8,
  feedback: '通过',
  issues: []
})
const fail = JSON.stringify({
  result: 'FAIL',
  score: 4,
  feedback: '修改节奏',
  issues: []
})
let root: string
const config = {
  entryStage: 'script' as const,
  pipelineSettings: {
    maxRetries: 2,
    scriptWordCountMin: 1,
    scriptWordCountMax: 5000
  }
}
function put(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function machine(provider: ILLMProvider) {
  const instance = new PipelineStateMachine('/unused/skills')
  const internal = instance as unknown as {
    llmProvider: ILLMProvider
    workflowEngine: WorkflowEngine
  }
  internal.llmProvider = provider
  internal.workflowEngine.setProvider(provider)
  instance.on('error', () => undefined)
  return instance
}
function params() {
  return {
    projectId: 'project',
    projectPath: root,
    episodeNum: 1,
    operationId: 'batch-logical-operation',
    projectConfig: config,
    projectContext: {
      projectName: '项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      episodeNumber: 1
    },
    startStage: 'director' as const,
    singleStage: true
  }
}
function provider(
  sameContent = false,
  stage: AutomatedPipelineStage = 'director'
) {
  let generations = 0
  const generate = vi.fn().mockResolvedValue(pass)
  const generateStream = vi.fn(async function* () {
    generations++
    const body =
      stage === 'art'
        ? '# 人物提示词\n\n## 林舟\n\n灰色外套，成年男子。\n\n# 场景道具提示词\n\n## 院子\n\n白日院落，木门。'
        : '# 分析与分镜\n讲戏内容'
    yield `${body}\n第${sameContent ? 1 : generations}版讲戏内容`
  })
  return {
    name: 'controlled',
    providerType: 'openai-compatible' as const,
    generate,
    generateStream,
    testConnection: vi.fn(),
    generations: () => generations
  }
}
async function prepareUpstream(stage: AutomatedPipelineStage) {
  if (stage === 'director') return
  const director = machine(provider())
  await director.start({ ...params(), operationId: 'upstream-director' })
  expect(director.getContext().error).toBeUndefined()
  if (stage === 'storyboard') {
    const art = machine(provider(false, 'art'))
    await art.start({
      ...params(),
      startStage: 'art',
      operationId: 'upstream-art'
    })
    expect(art.getContext().error).toBeUndefined()
  }
}

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'real-pipeline-review-')))
  put(resolveEpisodeArtifactPath(root, 'script', 1, config), script)
  const workflow = new WorkflowEngine('/unused/skills')
  workflow.setProvider(provider())
  await workflow.reviewStage('script_review', {
    projectPath: root,
    episodeNum: 1,
    projectConfig: config,
    operationId: 'approve-script'
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('real pipeline generation and durable review attempts', () => {
  it.each([
    ['director', false],
    ['director', true],
    ['art', false],
    ['art', true],
    ['storyboard', false],
    ['storyboard', true]
  ] as const)(
    'retries %s FAIL with an independent review attempt (same body: %s)',
    async (stage, sameBody) => {
      await prepareUpstream(stage)
      const controlled = provider(sameBody, stage)
      controlled.generate
        .mockResolvedValueOnce(fail)
        .mockResolvedValueOnce(pass)
      const pipeline = machine(controlled)
      await pipeline.start({ ...params(), startStage: stage })
      expect(pipeline.getContext().error).toBeUndefined()
      expect(pipeline.getState()).toBe(
        stage === 'storyboard' ? 'episode_complete' : `${stage}_done`
      )
      expect(controlled.generations()).toBe(2)
      expect(controlled.generate).toHaveBeenCalledTimes(4)
      const reviewStage = stage === 'storyboard' ? 'storyboard_review' : stage
      const attempts = new ProductionCommitStore(root, config)
        .list()
        .filter(
          (r) =>
            r.key === `review:${reviewStage}:1` &&
            r.operationId.startsWith(params().operationId)
        )
      expect(
        attempts
          .map(
            (r) => (r.result as { review: { result: string } }).review.result
          )
          .sort()
      ).toEqual(['FAIL', 'PASS'])
      expect(new Set(attempts.map((r) => r.operationId)).size).toBe(2)
      expect(new Set(attempts.map((r) => r.inputHash)).size).toBe(
        sameBody ? 1 : 2
      )
    }
  )

  it('continues a batch operation interrupted immediately after its durable FAIL without replaying the cached failure', async () => {
    const controlled = provider(true)
    controlled.generate.mockResolvedValueOnce(fail).mockResolvedValueOnce(pass)
    const first = machine(controlled)
    first.once('reviewResult', () => {
      void first.abort()
    })
    await first.start(params())
    expect(controlled.generations()).toBe(1)
    expect(controlled.generate).toHaveBeenCalledTimes(2)
    const second = machine(controlled)
    await second.start(params())
    expect(second.getContext().error).toBeUndefined()
    expect(second.getState()).toBe('director_done')
    expect(controlled.generations()).toBe(2)
    expect(controlled.generate).toHaveBeenCalledTimes(4)
    const attempts = new ProductionCommitStore(root, config)
      .list()
      .filter((r) => r.key === 'review:director:1')
    expect(attempts.map((r) => r.operationId).sort()).toEqual([
      `${params().operationId}:review:director:0`,
      `${params().operationId}:review:director:1`
    ])
  })

  it('resumes a provider error after FAIL with the same pending attempt and generated body', async () => {
    const controlled = provider()
    controlled.generate
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(pass)
      .mockRejectedValueOnce(new Error('provider offline'))
    const first = machine(controlled)
    await first.start(params())
    expect(first.getState()).toBe('error')
    expect(controlled.generations()).toBe(2)
    controlled.generate.mockRejectedValueOnce(
      new Error('provider still offline')
    )
    const second = machine(controlled)
    await second.start(params())
    expect(second.getState()).toBe('error')
    expect(controlled.generations()).toBe(2)
    const third = machine(controlled)
    await third.start(params())
    expect(third.getContext().error).toBeUndefined()
    expect(third.getState()).toBe('director_done')
    expect(controlled.generations()).toBe(2)
    const attempts = new ProductionCommitStore(root, config)
      .list()
      .filter((r) => r.key === 'review:director:1')
    expect(attempts).toHaveLength(2)
    expect(attempts.every((r) => r.phase === 'committed')).toBe(true)
    const body = readFileSync(
      resolveEpisodeArtifactPath(root, 'directorAnalysis', 1, config),
      'utf8'
    )
    expect(body).toContain('第2版')
  })

  it.each(['prepared', 'installed:0'])(
    'recovers the successful attempt after %s and replays the batch operation without another generation or review',
    async (boundary) => {
      const controlled = provider()
      controlled.generate
        .mockResolvedValueOnce(fail)
        .mockResolvedValueOnce(pass)
      const original = ProductionCommitStore.prototype.install
      const inject = vi
        .spyOn(ProductionCommitStore.prototype, 'install')
        .mockImplementation(function (this: ProductionCommitStore, record) {
          if (
            record.operationId === `${params().operationId}:review:director:1`
          ) {
            inject.mockRestore()
            if (boundary === 'prepared')
              throw new Error('publication interrupted')
            return original.call(
              new ProductionCommitStore(root, config, (point) => {
                if (point === boundary)
                  throw new Error('publication interrupted')
              }),
              record
            )
          }
          return original.call(this, record)
        })
      await machine(controlled)
        .start(params())
        .catch(() => undefined)
      const store = new ProductionCommitStore(root, config)
      expect(
        store.get(
          `${params().operationId}:review:director:1`,
          'review:director:1'
        )?.phase
      ).toBe('prepared')
      expect(controlled.generations()).toBe(2)
      expect(controlled.generate).toHaveBeenCalledTimes(4)
      for (let replay = 0; replay < 2; replay++) {
        const resumed = machine(controlled)
        await resumed.start(params())
        expect(resumed.getContext().error).toBeUndefined()
        expect(resumed.getState()).toBe('director_done')
      }
      expect(controlled.generations()).toBe(2)
      expect(controlled.generate).toHaveBeenCalledTimes(4)
      const episode = JSON.parse(
        readFileSync(
          resolveProjectArtifactPath(root, 'pipelineState', config),
          'utf8'
        )
      ).episodes['1']
      expect(episode.reviews).toHaveLength(2)
      expect(episode.stageStates.director).toMatchObject({
        status: 'passed',
        attempts: 2,
        operationId: params().operationId
      })
    }
  )

  it.each([true, false])(
    'refuses changed input on a pending attempt instead of relabeling it (marker retained: %s)',
    async (retainMarker) => {
      const controlled = provider()
      controlled.generate.mockRejectedValueOnce(new Error('provider offline'))
      const first = machine(controlled)
      await first.start(params())
      expect(first.getState()).toBe('error')
      const path = resolveEpisodeArtifactPath(
        root,
        'directorAnalysis',
        1,
        config
      )
      const old = readFileSync(path, 'utf8')
      put(
        path,
        retainMarker ? `${old}\nexternal edit` : '# Entire external replacement'
      )
      const second = machine(controlled)
      await second.start(params())
      expect(second.getState()).toBe('error')
      expect(second.getContext().error).toContain(
        retainMarker ? '不同输入' : '身份已变化'
      )
      expect(controlled.generations()).toBe(1)
      expect(controlled.generate).toHaveBeenCalledTimes(1)
      expect(readFileSync(path, 'utf8')).toBe(
        retainMarker ? `${old}\nexternal edit` : '# Entire external replacement'
      )
      expect(
        new ProductionCommitStore(root, config)
          .list()
          .filter((r) => r.key === 'review:director:1')
      ).toHaveLength(1)
    }
  )
})
