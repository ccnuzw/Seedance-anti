import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PipelineStateMachine } from './state-machine'
import type {
  WorkflowEngine,
  WorkflowGenerateResult
} from '../workflow/workflow-engine'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'

const tempDirs: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'feicai-lifecycle-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'script'), { recursive: true })
  writeFileSync(resolveEpisodeArtifactPath(root, 'script', 1), '# EP01 剧本')
  const machine = new PipelineStateMachine('/unused-skills')
  // Inert injection: test the real state machine, never call a real model.
  const internals = machine as unknown as {
    llmProvider: unknown
    workflowEngine: WorkflowEngine
  }
  internals.llmProvider = {}
  const generate = vi
    .spyOn(internals.workflowEngine, 'generateStage')
    .mockImplementation(async (stage) => ({
      stage,
      content: '生成内容',
      outputPath: join(root, `${stage}.md`),
      promptMetrics: { systemChars: 1, userChars: 1 }
    }))
  const review = vi
    .spyOn(internals.workflowEngine, 'reviewStage')
    .mockImplementation(async (stage) => ({
      stage,
      review: {
        stage,
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: '通过',
        issues: [],
        createdAt: new Date().toISOString()
      }
    }))
  const params = {
    projectId: 'project',
    projectPath: root,
    episodeNum: 1,
    projectContext: {
      projectName: '项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      episodeNumber: 1
    },
    startStage: 'director' as const,
    singleStage: true
  }
  return { root, machine, generate, review, params }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of tempDirs.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('observable pipeline lifecycle', () => {
  it('rejects invalid settings before occupying the machine or generating', () => {
    const { machine, params, generate } = fixture()
    expect(() => machine.setPipelineSettings({ maxRetries: -1 })).toThrow()
    expect(() =>
      machine.start({
        ...params,
        projectConfig: { pipelineSettings: { durationMin: 200 } }
      })
    ).toThrow('不能大于')
    expect(machine.isRunning()).toBe(false)
    expect(generate).not.toHaveBeenCalled()
  })

  it('completes a stage only after durable status and permits the next task', async () => {
    const { machine, root, params } = fixture()
    await machine.start(params)
    expect(machine.getState()).toBe('director_done')
    expect(machine.isRunning()).toBe(false)
    const state = JSON.parse(
      readFileSync(resolveProjectArtifactPath(root, 'pipelineState'), 'utf8')
    )
    expect(state.episodes['1'].stageStates.director.status).toBe('passed')
    expect(state.episodes['1'].status).toBe('director')
    await machine.start({ ...params, startStage: 'art' })
    expect(machine.getState()).toBe('art_done')
    await machine.start({ ...params, startStage: 'storyboard' })
    expect(machine.getState()).toBe('episode_complete')
    expect(
      JSON.parse(
        readFileSync(resolveProjectArtifactPath(root, 'pipelineState'), 'utf8')
      ).episodes['1'].status
    ).toBe('complete')
  })

  it('acquires its active slot synchronously and refuses a second start while initialization is pending', async () => {
    const { machine, params } = fixture()
    const first = machine.start(params)
    expect(() => machine.start(params)).toThrow('任务仍在执行')
    expect(machine.getContext().running).toBe(true)
    await first
  })

  it('pause retains the same coroutine and resume runs its pending review', async () => {
    const { machine, params, generate, review } = fixture()
    const entered = Promise.withResolvers<void>()
    const generated = Promise.withResolvers<WorkflowGenerateResult>()
    generate.mockImplementationOnce(async () => {
      entered.resolve()
      return generated.promise
    })
    const running = machine.start(params)
    await entered.promise
    machine.pause()
    generated.resolve({
      stage: 'director',
      content: '内容',
      outputPath: '/output.md',
      promptMetrics: { systemChars: 1, userChars: 1 }
    })
    await Promise.resolve()
    expect(machine.getState()).toBe('paused')
    expect(machine.isRunning()).toBe(true)
    expect(review).not.toHaveBeenCalled()
    machine.resume()
    await running
    expect(review).toHaveBeenCalledTimes(1)
    expect(machine.getState()).toBe('director_done')
  })

  it('stop waits for the old provider to settle and cannot leak a review into a new run', async () => {
    const { machine, params, generate, review } = fixture()
    const entered = Promise.withResolvers<void>()
    const generated = Promise.withResolvers<WorkflowGenerateResult>()
    generate.mockImplementationOnce(async (_stage, context) => {
      entered.resolve()
      expect(context.signal).toBeInstanceOf(AbortSignal)
      return generated.promise
    })
    const running = machine.start(params)
    await entered.promise
    let stopped = false
    const stopping = machine.abort().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(() => machine.start(params)).toThrow()
    generated.resolve({
      stage: 'director',
      content: '旧响应',
      outputPath: '/old.md',
      promptMetrics: { systemChars: 1, userChars: 1 }
    })
    await stopping
    await running
    expect(review).not.toHaveBeenCalled()
    expect(machine.getState()).toBe('idle')
    expect(machine.isRunning()).toBe(false)
    await machine.start(params)
    expect(review).toHaveBeenCalledTimes(1)
  })

  it('waitForCompletion tracks settle, not a prematurely emitted visual terminal state', async () => {
    const { machine, params, generate } = fixture()
    const entered = Promise.withResolvers<void>()
    const generated = Promise.withResolvers<WorkflowGenerateResult>()
    generate.mockImplementationOnce(async () => {
      entered.resolve()
      return generated.promise
    })
    const running = machine.start(params)
    await entered.promise
    let complete = false
    const completion = machine.waitForCompletion().then(() => {
      complete = true
    })
    machine.emit('stateChanged', { newState: 'episode_complete' })
    await Promise.resolve()
    expect(complete).toBe(false)
    generated.resolve({
      stage: 'director',
      content: '内容',
      outputPath: '/output.md',
      promptMetrics: { systemChars: 1, userChars: 1 }
    })
    await running
    await completion
    expect(complete).toBe(true)
  })
})
