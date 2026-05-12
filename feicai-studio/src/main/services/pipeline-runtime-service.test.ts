import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAllWindows = vi.fn()
const pipelineOn = vi.fn()
const runnerConstructor = vi.fn()
const pipelineConstructor = vi.fn()
const eventHandlers = new Map<string, (data: unknown) => void>()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows
  }
}))

vi.mock('../engine/state-machine', () => ({
  PipelineStateMachine: class MockPipelineStateMachine {
    constructor(skillsDir: string) {
      pipelineConstructor(skillsDir)
    }

    on = (event: string, handler: (data: unknown) => void) => {
      eventHandlers.set(event, handler)
      pipelineOn(event, handler)
    }
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
  getSkillsDir: vi.fn(() => '/tmp/skills')
}))

describe('pipeline-runtime-service', async () => {
  const service = await import('./pipeline-runtime-service')

  beforeEach(() => {
    vi.clearAllMocks()
    eventHandlers.clear()
    service.resetPipelineRuntime()
  })

  it('会缓存 pipeline 实例并在首次创建时绑定事件转发', () => {
    getAllWindows.mockReturnValue([])

    const first = service.getPipelineRuntime()
    const second = service.getPipelineRuntime()

    expect(first).toBe(second)
    expect(pipelineConstructor).toHaveBeenCalledTimes(1)
    expect(pipelineConstructor).toHaveBeenCalledWith('/tmp/skills')
    expect(pipelineOn).toHaveBeenCalledTimes(6)
  })

  it('会缓存 workflow runner 实例', () => {
    const first = service.getWorkflowRunnerRuntime()
    const second = service.getWorkflowRunnerRuntime()

    expect(first).toBe(second)
    expect(runnerConstructor).toHaveBeenCalledTimes(1)
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
    service.getPipelineRuntime()

    eventHandlers.get('stateChanged')?.({ state: 'director_done' })
    eventHandlers.get('log')?.({ level: 'info', message: 'hello' })
    eventHandlers.get('error')?.({ error: 'boom' })

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
