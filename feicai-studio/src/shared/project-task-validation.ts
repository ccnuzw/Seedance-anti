import type { ProjectConfig } from './types'
import { resolveBuiltinTaskTemplates } from './template-catalog'

export type ProjectTaskValidationSeverity = 'error' | 'warning'

export interface ProjectTaskValidationIssue {
  severity: ProjectTaskValidationSeverity
  scope: 'template' | 'schedule' | 'alerts'
  id?: string
  field: string
  message: string
}

function isValidDailyTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function isValidDateTime(value: string): boolean {
  return Number.isFinite(new Date(value).getTime())
}

export function validateProjectTaskAutomation(
  config: Pick<ProjectConfig, 'taskTemplates' | 'taskSchedules' | 'taskAlerts'>,
  totalEpisodes?: number
): ProjectTaskValidationIssue[] {
  const issues: ProjectTaskValidationIssue[] = []
  const templates = config.taskTemplates || []
  const schedules = config.taskSchedules || []

  const templateIds = new Set<string>(resolveBuiltinTaskTemplates().map((template) => template.id))
  for (const template of templates) {
    if (templateIds.has(template.id)) {
      issues.push({
        severity: 'error',
        scope: 'template',
        id: template.id,
        field: 'id',
        message: `模板 ID「${template.id}」重复，会导致调度引用不稳定`
      })
    }
    templateIds.add(template.id)

    if (template.singleStage && !template.startStage) {
      issues.push({
        severity: 'warning',
        scope: 'template',
        id: template.id,
        field: 'singleStage',
        message: `模板「${template.label}」设置了单阶段，但未指定起始阶段，将按全流程执行`
      })
    }
  }

  const scheduleIds = new Set<string>()
  for (const schedule of schedules) {
    if (scheduleIds.has(schedule.id)) {
      issues.push({
        severity: 'error',
        scope: 'schedule',
        id: schedule.id,
        field: 'id',
        message: `计划 ID「${schedule.id}」重复，会导致自动化去重失效`
      })
    }
    scheduleIds.add(schedule.id)

    if (schedule.templateId && !templateIds.has(schedule.templateId)) {
      issues.push({
        severity: 'error',
        scope: 'schedule',
        id: schedule.id,
        field: 'templateId',
        message: `计划「${schedule.label}」引用了不存在的模板「${schedule.templateId}」`
      })
    }

    if (!schedule.episodeNumbers.length) {
      issues.push({
        severity: 'error',
        scope: 'schedule',
        id: schedule.id,
        field: 'episodeNumbers',
        message: `计划「${schedule.label}」未配置任何集数`
      })
    }

    if (typeof totalEpisodes === 'number' && totalEpisodes > 0) {
      const overflowEpisodes = schedule.episodeNumbers.filter((episodeNum) => episodeNum > totalEpisodes)
      if (overflowEpisodes.length > 0) {
        issues.push({
          severity: 'warning',
          scope: 'schedule',
          id: schedule.id,
          field: 'episodeNumbers',
          message: `计划「${schedule.label}」包含超出项目总集数的集数：${overflowEpisodes.join(', ')}`
        })
      }
    }

    if (schedule.frequency === 'daily' && !isValidDailyTime(schedule.timeValue)) {
      issues.push({
        severity: 'error',
        scope: 'schedule',
        id: schedule.id,
        field: 'timeValue',
        message: `计划「${schedule.label}」的每日触发时间无效，需为 HH:mm`
      })
    }

    if (schedule.frequency === 'once' && !isValidDateTime(schedule.timeValue)) {
      issues.push({
        severity: 'error',
        scope: 'schedule',
        id: schedule.id,
        field: 'timeValue',
        message: `计划「${schedule.label}」的一次性触发时间无效`
      })
    }
  }

  return issues
}
