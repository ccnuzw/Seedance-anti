import type { ProjectTaskSchedule } from './types'

export function buildAutomationKey(
  projectId: string,
  scheduleId: string,
  automationSuffix: string,
  episodeNum: number
): string {
  return `${projectId}:${scheduleId}:${automationSuffix}:ep${episodeNum}`
}

export function resolveScheduleOccurrence(
  schedule: ProjectTaskSchedule,
  now = new Date()
): {
  automationSuffix: string
  scheduledAt: string
} | null {
  if (schedule.frequency === 'once') {
    const scheduledAt = new Date(schedule.timeValue)
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() > now.getTime()) {
      return null
    }
    return {
      automationSuffix: `once:${scheduledAt.toISOString()}`,
      scheduledAt: scheduledAt.toISOString()
    }
  }

  const match = schedule.timeValue.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null

  const scheduledAt = new Date(now)
  scheduledAt.setSeconds(0, 0)
  scheduledAt.setHours(Number(match[1]), Number(match[2]), 0, 0)
  if (scheduledAt.getTime() > now.getTime()) {
    return null
  }

  const dayKey = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, '0')}-${String(scheduledAt.getDate()).padStart(2, '0')}`
  return {
    automationSuffix: `daily:${dayKey}`,
    scheduledAt: scheduledAt.toISOString()
  }
}
