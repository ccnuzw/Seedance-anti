import { describe, expect, it, vi } from 'vitest'
import type { ExecutionStatus } from '@shared/ipc-contracts'
import type { PipelineTaskSnapshot } from '@shared/pipeline-task'
import {
  getBatchBackgroundView,
  refreshAfterExecutionReleases
} from './batch-page-state'

const task = {
  identity: {
    projectId: 'project-1',
    taskId: 'task-1',
    runId: 'run-1',
    episodeNum: 1,
    stage: 'story'
  },
  kind: 'workflow',
  status: 'running',
  settings: {}
} as PipelineTaskSnapshot

describe('batch-page-state', () => {
  it('independent workflow failure path remains fail closed until lease status is readable', () => {
    expect(
      getBatchBackgroundView(
        { busy: true, phase: 'running', owner: 'workflow' },
        [task],
        'project-1'
      )
    ).toMatchObject({ state: 'running', task })
  })

  it('refreshes only after lease release and stops at bounded retry', async () => {
    const statuses: ExecutionStatus[] = [
      { busy: true, phase: 'stopping', owner: 'workflow' },
      { busy: false, phase: 'idle' }
    ]
    const refresh = vi.fn(async () => undefined)
    const result = await refreshAfterExecutionReleases({
      getStatus: async () => statuses.shift()!,
      refresh,
      delay: async () => undefined
    })
    expect(result).toBe('refreshed')
    expect(refresh).toHaveBeenCalledTimes(1)

    const stillBusy = await refreshAfterExecutionReleases({
      getStatus: async () => ({
        busy: true,
        phase: 'running',
        owner: 'pipeline'
      }),
      refresh,
      delay: async () => undefined,
      maxAttempts: 2
    })
    expect(stillBusy).toBe('still-busy')
  })
})
