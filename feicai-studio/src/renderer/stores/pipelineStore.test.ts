import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PipelineContext,
  PipelineState,
  ReviewResult
} from '@shared/types'

const startPipeline = vi.fn()
const pausePipeline = vi.fn()
const abortPipeline = vi.fn()
const retryPipeline = vi.fn()
const skipPipeline = vi.fn()
const getPipelineState = vi.fn()

type Callback = (payload: unknown) => void
const listeners = {
  stateChanged: [] as Callback[],
  log: [] as Callback[],
  stream: [] as Callback[],
  reviewResult: [] as Callback[],
  error: [] as Callback[],
  taskChanged: [] as Callback[]
}

function resetListeners(): void {
  listeners.stateChanged = []
  listeners.log = []
  listeners.stream = []
  listeners.reviewResult = []
  listeners.error = []
  listeners.taskChanged = []
}

function subscribe(bucket: Callback[], callback: Callback) {
  bucket.push(callback)
  return () => {
    const index = bucket.indexOf(callback)
    if (index >= 0) bucket.splice(index, 1)
  }
}

const syncSingleEpisodeStatus = vi.fn()
const syncEpisodeStatus = vi.fn()
let currentProject: { id: string } | null = null

vi.mock('@renderer/services/pipeline-service', () => ({
  startPipeline,
  pausePipeline,
  abortPipeline,
  retryPipeline,
  skipPipeline,
  getPipelineState,
  pipelineEvents: {
    onTaskChanged: (cb: Callback) => subscribe(listeners.taskChanged, cb),
    onStateChanged: (cb: Callback) => subscribe(listeners.stateChanged, cb),
    onLog: (cb: Callback) => subscribe(listeners.log, cb),
    onStream: (cb: Callback) => subscribe(listeners.stream, cb),
    onReviewResult: (cb: Callback) => subscribe(listeners.reviewResult, cb),
    onError: (cb: Callback) => subscribe(listeners.error, cb)
  }
}))

vi.mock('@renderer/stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      currentProject,
      syncSingleEpisodeStatus,
      syncEpisodeStatus
    })
  }
}))

function emitState(newState: PipelineState, context: PipelineContext): void {
  for (const cb of listeners.stateChanged) cb({ newState, context })
}

function emitLog(entry: Record<string, unknown>): void {
  for (const cb of listeners.log) cb(entry)
}

function emitStream(chunk: string): void {
  for (const cb of listeners.stream) cb({ chunk })
}

function emitReviewResult(result: ReviewResult): void {
  for (const cb of listeners.reviewResult) cb({ result })
}

describe('usePipelineStore', async () => {
  const { usePipelineStore } = await import('./pipelineStore')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetListeners()
    currentProject = null
    usePipelineStore.setState({
      runIdentity: null,
      state: 'idle',
      context: null,
      logs: [],
      streamBuffer: '',
      isRunning: false,
      currentReview: null,
      pipelineStartedAt: null,
      stageTimings: [],
      currentStageName: null
    })
  })

  afterEach(() => {
    const cleanup = usePipelineStore.getState().setupEventListeners()
    cleanup()
    vi.useRealTimers()
  })

  it('能根据事件推进状态、计时、日志与流输出，并在完成后同步单集状态', async () => {
    const cleanup = usePipelineStore.getState().setupEventListeners()

    const context: PipelineContext = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 2,
      currentStage: 'director',
      state: 'director_analyzing',
      retryCount: 0,
      reviews: [],
      logs: []
    }

    emitState('script_done', { ...context, state: 'script_done' })
    emitState('director_analyzing', context)
    emitLog({
      id: 'log-1',
      episodeId: 'ep02',
      stage: 'director',
      level: 'info',
      eventType: 'start',
      message: '开始导演分析',
      timestamp: new Date().toISOString()
    })
    emitStream('chunk-a')
    emitStream('chunk-b')

    vi.advanceTimersByTime(100)

    expect(usePipelineStore.getState().state).toBe('director_analyzing')
    expect(usePipelineStore.getState().currentStageName).toBe('director')
    expect(usePipelineStore.getState().stageTimings).toHaveLength(1)
    expect(usePipelineStore.getState().logs).toHaveLength(1)
    expect(usePipelineStore.getState().streamBuffer).toBe('chunk-achunk-b')

    const review: ReviewResult = {
      stage: 'director',
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 8,
      feedback: '通过',
      issues: [],
      createdAt: new Date().toISOString()
    }
    emitReviewResult(review)
    emitState('episode_complete', {
      ...context,
      state: 'episode_complete',
      reviews: [review]
    })
    vi.advanceTimersByTime(100)

    expect(usePipelineStore.getState().currentReview).toEqual(review)
    expect(usePipelineStore.getState().state).toBe('episode_complete')
    expect(usePipelineStore.getState().isRunning).toBe(false)
    expect(syncSingleEpisodeStatus).toHaveBeenCalledWith(2)

    cleanup()
  })

  it('rejects stale state, logs, stream, reviews and errors by full identity', () => {
    const cleanup = usePipelineStore.getState().setupEventListeners()
    currentProject = { id: 'project-1' }
    const identity = {
      projectId: 'project-1',
      taskId: 'task-2',
      runId: 'run-2',
      episodeNum: 1
    }
    const context: PipelineContext = {
      ...identity,
      projectPath: '/project',
      currentStage: 'director',
      state: 'director_analyzing',
      retryCount: 0,
      logs: [],
      reviews: []
    }
    for (const cb of listeners.stateChanged)
      cb({ identity, newState: context.state, context })
    for (const wrong of [
      { ...identity, runId: 'run-1' },
      { ...identity, taskId: 'task-1' },
      { ...identity, projectId: 'project-2' }
    ]) {
      for (const cb of listeners.stateChanged)
        cb({
          identity: wrong,
          newState: 'episode_complete',
          context: { ...context, ...wrong, state: 'episode_complete' }
        })
      for (const cb of listeners.log) cb({ identity: wrong, message: 'stale' })
      for (const cb of listeners.stream) cb({ identity: wrong, chunk: 'stale' })
      for (const cb of listeners.reviewResult)
        cb({ identity: wrong, result: { passed: true } })
      for (const cb of listeners.error) cb({ identity: wrong })
    }
    // Once the new contract is observed, unscoped legacy events cannot change it.
    for (const cb of listeners.error) cb({})
    for (const cb of listeners.stream) cb({ identity, chunk: 'current' })
    vi.advanceTimersByTime(100)
    expect(usePipelineStore.getState()).toMatchObject({
      state: 'director_analyzing',
      logs: [],
      streamBuffer: 'current',
      currentReview: null
    })
    expect(syncSingleEpisodeStatus).not.toHaveBeenCalled()
    cleanup()
  })

  it('sends controls to the displayed run and rejects controls after switching projects', async () => {
    const target = {
      projectId: 'project-1',
      taskId: 'task-1',
      runId: 'run-1',
      episodeNum: 1
    }
    currentProject = { id: 'project-1' }
    usePipelineStore.setState({ runIdentity: target })
    await usePipelineStore.getState().pausePipeline()
    expect(pausePipeline).toHaveBeenLastCalledWith(target)
    await usePipelineStore.getState().skipReviewPipeline()
    expect(skipPipeline).toHaveBeenLastCalledWith(target)
    await usePipelineStore.getState().stopPipeline()
    expect(abortPipeline).toHaveBeenLastCalledWith(target)
    currentProject = { id: 'project-2' }
    pausePipeline.mockClear()
    await expect(usePipelineStore.getState().pausePipeline()).rejects.toThrow(
      '不匹配'
    )
    expect(pausePipeline).not.toHaveBeenCalled()
  })

  it('discards buffered events on display reset and cleans up listeners and timers', () => {
    const cleanup = usePipelineStore.getState().setupEventListeners()
    emitLog({ message: 'old-log' })
    emitStream('old-stream')
    usePipelineStore.getState().resetDisplay()
    vi.advanceTimersByTime(100)
    expect(usePipelineStore.getState()).toMatchObject({
      logs: [],
      streamBuffer: ''
    })
    cleanup()
    for (const bucket of Object.values(listeners))
      expect(bucket).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses an authoritative snapshot for task announcements and ignores responses after project changes', async () => {
    const cleanup = usePipelineStore.getState().setupEventListeners()
    currentProject = { id: 'project-1' }
    const gate = Promise.withResolvers<PipelineContext>()
    getPipelineState.mockReturnValueOnce(gate.promise)
    for (const cb of listeners.taskChanged)
      cb({
        kind: 'pipeline',
        status: 'running',
        identity: {
          projectId: 'project-1',
          taskId: 'old-task',
          runId: 'old-run'
        }
      })
    currentProject = { id: 'project-2' }
    gate.resolve({
      projectId: 'project-1',
      state: 'director_analyzing'
    } as PipelineContext)
    await Promise.resolve()
    expect(usePipelineStore.getState().context).toBeNull()
    cleanup()
  })

  it('错误事件会停止运行态，reviewing 结束时会封口当前阶段计时', () => {
    const cleanup = usePipelineStore.getState().setupEventListeners()

    const context: PipelineContext = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 1,
      currentStage: 'director',
      state: 'director_reviewing',
      retryCount: 0,
      reviews: [],
      logs: []
    }

    emitState('director_reviewing', context)
    emitState('error', { ...context, state: 'error' })
    for (const cb of listeners.error) cb({})
    vi.advanceTimersByTime(100)

    const store = usePipelineStore.getState()
    expect(store.isRunning).toBe(false)
    expect(store.state).toBe('error')
    expect(store.stageTimings[0]?.stage).toBe('director')
    expect(store.stageTimings[0]?.endedAt).toBeTypeOf('number')

    cleanup()
  })
})
