import { describe, expect, it } from 'vitest'
import type { ProjectTaskSchedule } from './types'
import { buildAutomationKey, resolveScheduleOccurrence } from './pipeline-automation'

describe('shared pipeline automation helpers', () => {
  it('builds stable automation keys', () => {
    expect(buildAutomationKey('project-1', 'sch-1', 'daily:2026-03-24', 8))
      .toBe('project-1:sch-1:daily:2026-03-24:ep8')
  })

  it('resolves due daily schedules', () => {
    const schedule: ProjectTaskSchedule = {
      id: 'sch-daily',
      label: '每日补跑',
      enabled: true,
      episodeNumbers: [1, 2],
      frequency: 'daily',
      timeValue: '09:15'
    }

    expect(resolveScheduleOccurrence(schedule, new Date(2026, 2, 24, 9, 20, 0))).toEqual({
      automationSuffix: 'daily:2026-03-24',
      scheduledAt: new Date(2026, 2, 24, 9, 15, 0).toISOString()
    })
  })
})
