import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAllWindows = vi.fn()
const pipelineOn = vi.fn()
const runnerConstructor = vi.fn()
const pipelineConstructor = vi.fn()
const bindings = new Map<
  unknown,
  { emit: (event: string, data: unknown) => void; release: () => void }
>()
const resetPipelineTasks = vi.fn()
let describeProject: (id: string, path: string) => { maxRetries: number }
const loadPipelineSettings = vi.fn()

vi.mock('./batch-queue-service', () => ({
  BatchQueue: class {
    constructor(
      _path: string,
      deps: { describeProject: typeof describeProject }
    ) {
      describeProject = deps.describeProject
    }
  }
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows
  },
  app: { getPath: () => '/tmp/feicai-runtime-test' }
}))

vi.mock('../engine/state-machine', () => ({
  PipelineStateMachine: class MockPipelineStateMachine {
    constructor(skillsDir: string) {
      pipelineConstructor(skillsDir)
    }

    on = pipelineOn
  }
}))

vi.mock('../workflow/workflow-step-runner', () => ({
  WorkflowStepRunner: class MockWorkflowStepRunner {
    skillsDir: string

    constructor(skillsDir: string) {
      runnerConstructor(skillsDir)
      this.skillsDir = skillsDir
    }
  }
}))

vi.mock('./pipeline-service', () => ({
  getSkillsDir: vi.fn(() => '/tmp/skills'),
  loadPipelineSettings,
  bindPipelineRuntime: (
    engine: unknown,
    binding: {
      emit: (event: string, data: unknown) => void
      release: () => void
    }
  ) => bindings.set(engine, binding),
  resetPipelineTasks,
  setPipelineTaskSink: vi.fn()
}))
vi.mock('./project-service', () => ({
  getRegisteredProject: vi.fn(),
  getRegisteredProjectPlotBreakdownSummary: vi.fn(),
  listProjectEpisodes: vi.fn()
}))
vi.mock('./batch-queue-recovery', () => ({ recoverBatchCommit: vi.fn() }))

describe('pipeline-runtime-service', async () => {
  const service = await import('./pipeline-runtime-service')

  beforeEach(() => {
    vi.clearAllMocks()
    bindings.clear()
    service.resetPipelineRuntime()
  })

  it('uses validated disk settings for batch retries and propagates invalid config errors', async () => {
    const { mkdtempSync, rmSync, realpathSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { registerProjectRoot, resetAccessControl } =
      await import('../security/access-control')
    const { getRegisteredProject, listProjectEpisodes } =
      await import('./project-service')
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-settings-')))
    try {
      registerProjectRoot(root)
      vi.mocked(getRegisteredProject).mockReturnValue({
        projectPath: root,
        config: { pipelineSettings: { maxRetries: 99 } }
      } as ReturnType<typeof getRegisteredProject>)
      vi.mocked(listProjectEpisodes).mockReturnValue([])
      loadPipelineSettings.mockReturnValue({ maxRetries: 4 })
      service.getBatchQueueRuntime()
      expect(describeProject('project-1', root).maxRetries).toBe(4)
      expect(loadPipelineSettings).toHaveBeenCalledWith(root)
      loadPipelineSettings.mockImplementation(() => {
        throw new Error('流水线参数无效')
      })
      expect(() => describeProject('project-1', root)).toThrow('流水线参数无效')
      expect(pipelineConstructor).not.toHaveBeenCalled()
      expect(runnerConstructor).not.toHaveBeenCalled()
    } finally {
      resetAccessControl()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('只缓存当前运行实例，由服务在任务结束后释放', () => {
    getAllWindows.mockReturnValue([])

    const first = service.getPipelineRuntime()
    const second = service.getPipelineRuntime()

    expect(first).toBe(second)
    expect(pipelineConstructor).toHaveBeenCalledTimes(1)
    expect(pipelineConstructor).toHaveBeenCalledWith('/tmp/skills')
    expect(bindings.has(first)).toBe(true)
    expect(pipelineOn).not.toHaveBeenCalled()
    bindings.get(first)!.release()
    expect(service.getPipelineRuntime()).not.toBe(first)
    expect(pipelineConstructor).toHaveBeenCalledTimes(2)
  })

  it('每次提供独立 workflow runner，禁止共享可变provider上下文', () => {
    const first = service.getWorkflowRunnerRuntime()
    const second = service.getWorkflowRunnerRuntime()

    expect(first).not.toBe(second)
    expect(runnerConstructor).toHaveBeenCalledTimes(2)
    expect(runnerConstructor).toHaveBeenCalledWith('/tmp/skills')
  })

  it('重置后会重新创建 runtime 实例', () => {
    const first = service.getPipelineRuntime()
    service.resetPipelineRuntime()
    const second = service.getPipelineRuntime()

    expect(first).not.toBe(second)
    expect(pipelineConstructor).toHaveBeenCalledTimes(2)
  })

  it('会把 pipeline 事件转发给未销毁的渲染窗口', async () => {
    const sendLive = vi.fn()
    const sendDestroyed = vi.fn()
    getAllWindows.mockReturnValue([
      {
        isDestroyed: vi.fn(() => false),
        webContents: { send: sendLive }
      },
      {
        isDestroyed: vi.fn(() => true),
        webContents: { send: sendDestroyed }
      }
    ])

    const { IPC } = await import('@shared/ipc-channels')
    const engine = service.getPipelineRuntime()
    const binding = bindings.get(engine)!
    binding.emit('stateChanged', { state: 'director_done' })
    binding.emit('log', { level: 'info', message: 'hello' })
    binding.emit('error', { error: 'boom' })

    expect(sendLive).toHaveBeenCalledWith(IPC.PIPELINE_STATE_CHANGED, {
      state: 'director_done'
    })
    expect(sendLive).toHaveBeenCalledWith(IPC.PIPELINE_LOG, {
      level: 'info',
      message: 'hello'
    })
    expect(sendLive).toHaveBeenCalledWith(IPC.PIPELINE_ERROR, { error: 'boom' })
    expect(sendDestroyed).not.toHaveBeenCalled()
  })
})
