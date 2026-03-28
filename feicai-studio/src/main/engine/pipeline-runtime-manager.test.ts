import { describe, expect, it } from 'vitest'
import type { PipelineContext, ProjectTaskSchedule } from '@shared/types'
import { buildAutomationKey, resolveScheduleOccurrence } from '@shared/pipeline-automation'

function mapStatus(state: PipelineContext['state']) {
  if (state === 'paused') return 'paused'
  if (state === 'episode_complete' || state === 'director_done' || state === 'art_done') return 'completed'
  if (state === 'error') return 'failed'
  if (state === 'idle') return 'aborted'
  return 'running'
}

describe('pipeline runtime run status mapping', () => {
  it('maps terminal and active pipeline states to persisted run statuses', () => {
    expect(mapStatus('script_loaded')).toBe('running')
    expect(mapStatus('paused')).toBe('paused')
    expect(mapStatus('episode_complete')).toBe('completed')
    expect(mapStatus('error')).toBe('failed')
    expect(mapStatus('idle')).toBe('aborted')
  })
})

describe('pipeline automation scheduling helpers', () => {
  it('resolves due once schedules and keeps future ones pending', () => {
    const now = new Date('2026-03-23T12:30:00.000Z')
    const dueSchedule: ProjectTaskSchedule = {
      id: 'once-1',
      label: '一次性补跑',
      enabled: true,
      episodeNumbers: [1],
      frequency: 'once',
      timeValue: '2026-03-23T12:00:00.000Z'
    }
    const futureSchedule: ProjectTaskSchedule = {
      ...dueSchedule,
      id: 'once-2',
      timeValue: '2026-03-23T13:00:00.000Z'
    }

    expect(resolveScheduleOccurrence(dueSchedule, now)).toEqual({
      automationSuffix: 'once:2026-03-23T12:00:00.000Z',
      scheduledAt: '2026-03-23T12:00:00.000Z'
    })
    expect(resolveScheduleOccurrence(futureSchedule, now)).toBeNull()
  })

  it('resolves daily schedules to the current day and waits before the trigger time', () => {
    const daily: ProjectTaskSchedule = {
      id: 'daily-1',
      label: '每日巡检',
      enabled: true,
      episodeNumbers: [2, 3],
      frequency: 'daily',
      timeValue: '09:15'
    }
    const afterTrigger = new Date(2026, 2, 23, 9, 16, 20)
    const expectedScheduledAt = new Date(2026, 2, 23, 9, 15, 0).toISOString()

    expect(resolveScheduleOccurrence(daily, afterTrigger)).toEqual({
      automationSuffix: 'daily:2026-03-23',
      scheduledAt: expectedScheduledAt
    })
    expect(resolveScheduleOccurrence(daily, new Date(2026, 2, 23, 9, 14, 59))).toBeNull()
  })

  it('builds stable automation keys per schedule occurrence and episode', () => {
    expect(buildAutomationKey('project-1', 'sch-daily', 'daily:2026-03-23', 7))
      .toBe('project-1:sch-daily:daily:2026-03-23:ep7')
  })
})
