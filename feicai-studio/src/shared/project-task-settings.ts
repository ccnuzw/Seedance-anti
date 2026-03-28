import type {
  ProjectConfig,
  ProjectTaskAlertConfig,
  ProjectTaskDefaults,
  ProjectTaskSchedule,
  ProjectTaskTemplate
} from './types'
import {
  DEFAULT_PROJECT_TASK_ALERTS,
  DEFAULT_PROJECT_TASK_DEFAULTS
} from './types'
import { resolveBuiltinTaskTemplates } from './template-catalog'

export interface ResolvedProjectTaskSettings {
  defaults: ProjectTaskDefaults
  templates: ProjectTaskTemplate[]
  schedules: ProjectTaskSchedule[]
  alerts: ProjectTaskAlertConfig
}

export function resolveProjectTaskSettings(
  config?: Pick<ProjectConfig, 'taskDefaults' | 'taskTemplates' | 'taskSchedules' | 'taskAlerts'> | null
): ResolvedProjectTaskSettings {
  const builtinTemplates = resolveBuiltinTaskTemplates()
  const customTemplates = Array.isArray(config?.taskTemplates) ? config.taskTemplates : []
  const mergedTemplates = [...builtinTemplates]

  for (const template of customTemplates) {
    const existingIndex = mergedTemplates.findIndex((item) => item.id === template.id)
    if (existingIndex >= 0) {
      mergedTemplates[existingIndex] = { ...mergedTemplates[existingIndex], ...template, source: template.source || 'project' }
    } else {
      mergedTemplates.push({ ...template, source: template.source || 'project' })
    }
  }

  return {
    defaults: {
      ...DEFAULT_PROJECT_TASK_DEFAULTS,
      ...(config?.taskDefaults || {})
    },
    templates: mergedTemplates,
    schedules: Array.isArray(config?.taskSchedules) ? config.taskSchedules : [],
    alerts: {
      ...DEFAULT_PROJECT_TASK_ALERTS,
      ...(config?.taskAlerts || {})
    }
  }
}
