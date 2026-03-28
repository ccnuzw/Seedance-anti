import { describe, expect, it } from 'vitest'
import type { ProjectTaskTemplate } from '@shared/types'
import { buildBatchPlan, resolveBatchExecution, resolveScheduledAtInput } from './batch-planner'

describe('batch-planner', () => {
  const template: ProjectTaskTemplate = {
    id: 'tpl-art-fix',
    label: '服化道补跑',
    startStage: 'art',
    singleStage: true,
    priority: 'high',
    maxAutoRetries: 2,
    batchMode: 'sequential_on_success'
  }

  it('resolves scheduling input to ISO and rejects invalid datetime-local input', () => {
    expect(resolveScheduledAtInput('')).toEqual({})
    expect(resolveScheduledAtInput('2026-03-24T08:30')).toEqual({
      scheduledAtIso: new Date('2026-03-24T08:30').toISOString()
    })
    expect(resolveScheduledAtInput('bad-time')).toEqual({
      error: '定时时间格式无效'
    })
  })

  it('derives stage execution from current mode and selected template', () => {
    expect(resolveBatchExecution('art', template)).toEqual({
      startStage: 'art',
      singleStage: true
    })
    expect(resolveBatchExecution('full', template)).toEqual({
      startStage: undefined,
      singleStage: false
    })
  })

  it('builds independent plan requests without dependency chains', () => {
    const plan = buildBatchPlan({
      selectedEpisodes: [3, 1, 2],
      mode: 'full',
      batchMode: 'independent',
      batchLabel: '批次 A',
      priority: 'normal',
      maxAutoRetries: 1,
      batchId: 'batch-1'
    })

    expect(plan.requests.map((item) => item.episodeNum)).toEqual([1, 2, 3])
    expect(plan.requests.every((item) => !item.orchestration.dependsOnRootRunId)).toBe(true)
    expect(plan.startStage).toBeUndefined()
    expect(plan.singleStage).toBe(false)
  })

  it('builds sequential plan requests with the expected dependency condition and template metadata', () => {
    const plan = buildBatchPlan({
      selectedEpisodes: [1, 2, 3],
      mode: 'art',
      batchMode: 'sequential_on_success',
      batchLabel: '批次 B',
      priority: 'high',
      maxAutoRetries: 2,
      scheduledAt: '2026-03-24T10:15',
      selectedTemplate: template,
      batchId: 'batch-2'
    })

    expect(plan.scheduledAtIso).toBe(new Date('2026-03-24T10:15').toISOString())
    expect(plan.startStage).toBe('art')
    expect(plan.singleStage).toBe(true)
    expect(plan.requests[0]?.orchestration.dependsOnRootRunId).toBeUndefined()
    expect(plan.requests[1]?.orchestration.dependsOnRootRunId).toBe('planned-root-1')
    expect(plan.requests[2]?.orchestration.dependsOnRootRunId).toBe('planned-root-2')
    expect(plan.requests.every((item) => item.orchestration.condition === 'on_success')).toBe(true)
    expect(plan.requests.every((item) => item.strategy.templateId === 'tpl-art-fix')).toBe(true)
  })

  it('builds sequential-always plans with always condition', () => {
    const plan = buildBatchPlan({
      selectedEpisodes: [5, 6],
      mode: 'director',
      batchMode: 'sequential_always',
      batchLabel: '批次 C',
      priority: 'low',
      maxAutoRetries: 0,
      batchId: 'batch-3'
    })

    expect(plan.requests.every((item) => item.orchestration.condition === 'always')).toBe(true)
    expect(plan.requests[1]?.orchestration.dependsOnRootRunId).toBe('planned-root-5')
  })
})
