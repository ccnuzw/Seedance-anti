import { afterEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  Object.assign(globalThis, { window: { feicaiAPI: {} } })
})
import { assertExecutionAvailable } from './task-center-admission'
import { startPipeline } from './pipeline-service'
import { runStoryGeneration } from './workflow-actions'
import { batchService } from './batch-service'

afterEach(() => vi.unstubAllGlobals())
describe('global admission status query', () => {
  for (const phase of ['running', 'paused', 'stopping'] as const) {
    it(`rejects starts while a ${phase} worker holds the lease`, async () => {
      const start = vi.fn()
      vi.stubGlobal('window', {
        feicaiAPI: {
          getExecutionStatus: async () => ({
            busy: true,
            phase,
            owner: 'workflow'
          }),
          startPipeline: start,
          runStoryGeneration: start,
          startBatch: start
        }
      })
      await expect(
        startPipeline({} as Parameters<typeof startPipeline>[0])
      ).rejects.toThrow('后台任务')
      await expect(
        runStoryGeneration({} as Parameters<typeof runStoryGeneration>[0])
      ).rejects.toThrow('后台任务')
      await expect(
        batchService.startBatch(
          {} as Parameters<typeof batchService.startBatch>[0]
        )
      ).rejects.toThrow('后台任务')
      expect(start).not.toHaveBeenCalled()
    })
  }
  it('fails closed on unknown status and permits only verified idle', async () => {
    vi.stubGlobal('window', {
      feicaiAPI: {
        getExecutionStatus: vi.fn().mockRejectedValue(new Error('offline'))
      }
    })
    await expect(assertExecutionAvailable()).rejects.toThrow('状态未知')
    vi.mocked(window.feicaiAPI.getExecutionStatus).mockResolvedValue({
      busy: false,
      phase: 'idle'
    })
    await expect(assertExecutionAvailable()).resolves.toBeUndefined()
  })
})
