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
  error: [] as Callback[]
}

function resetListeners(): void {
  listeners.stateChanged = []
  listeners.log = []
  listeners.stream = []
  listeners.reviewResult = []
  listeners.error = []
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

vi.mock('@renderer/services/pipeline-service', () => ({
  startPipeline,
  pausePipeline,
  abortPipeline,
  retryPipeline,
  skipPipeline,
  getPipelineState,
  pipelineEvents: {
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
    usePipelineStore.setState({
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
