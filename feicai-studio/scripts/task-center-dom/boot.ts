/* eslint-disable @typescript-eslint/no-explicit-any */
const fixture: any = {
  tasks: [],
  queue: null,
  execution: { busy: false, phase: 'idle' },
  calls: [],
  listeners: {},
  fail: false,
  defer: null
}
const record = (method: string, args: unknown[]) =>
  fixture.calls.push({ method, args })
const subscribe = (name: string) => (callback: () => void) => {
  fixture.listeners[name] = callback
  return () => {
    delete fixture.listeners[name]
  }
}
;(window as any).fixture = fixture
;(window as any).feicaiAPI = {
  listPipelineTasks: async () => {
    if (fixture.fail) throw new Error('synthetic offline')
    if (fixture.defer) await fixture.defer
    return structuredClone(fixture.tasks)
  },
  getBatchState: async () => structuredClone(fixture.queue),
  getExecutionStatus: async () => {
    if (fixture.fail) throw new Error('synthetic offline')
    return structuredClone(fixture.execution)
  },
  controlPipelineTask: async (request: any) => {
    record('control', [request])
    if (request.action === 'abort') {
      fixture.execution.phase = 'stopping'
      fixture.listeners.task?.()
      await fixture.stopping
      fixture.tasks[0].status = 'stopped'
      fixture.execution = { busy: false, phase: 'idle' }
    } else {
      fixture.tasks[0].status =
        request.action === 'pause' ? 'paused' : 'running'
      fixture.execution.phase = fixture.tasks[0].status
    }
    fixture.listeners.task?.()
    return { success: true }
  },
  onPipelineTaskChanged: subscribe('task'),
  onPipelineStateChanged: subscribe('state'),
  onBatchState: subscribe('batch'),
  onPipelineLog: subscribe('log'),
  onPipelineStream: subscribe('stream'),
  onPipelineReviewResult: subscribe('review'),
  onPipelineError: subscribe('error'),
  pauseBatch: async (id: string) => {
    record('pauseBatch', [id])
    return fixture.queue
  },
  resumeBatch: async (id: string) => {
    record('resumeBatch', [id])
    return fixture.queue
  },
  stopBatch: async (id: string) => {
    record('stopBatch', [id])
    return fixture.queue
  }
}
window.confirm = () => true
void import('./suite')
