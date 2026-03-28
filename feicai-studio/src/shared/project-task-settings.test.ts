import { describe, expect, it } from 'vitest'
import { resolveProjectTaskSettings } from './project-task-settings'

describe('project-task-settings', () => {
  it('merges project task defaults and alert toggles while preserving arrays', () => {
    const settings = resolveProjectTaskSettings({
      taskDefaults: {
        defaultPriority: 'high',
        defaultMaxAutoRetries: 2
      },
      taskTemplates: [
        {
          id: 'tpl-fast',
          label: '快速补跑',
          priority: 'high',
          maxAutoRetries: 2,
          batchMode: 'sequential_on_success'
        }
      ],
      taskSchedules: [
        {
          id: 'sch-daily',
          label: '日报回填',
          enabled: true,
          episodeNumbers: [1, 2],
          frequency: 'daily',
          timeValue: '09:30'
        }
      ],
      taskAlerts: {
        notifyOnRunFailed: false
      }
    })

    expect(settings.defaults.defaultPriority).toBe('high')
    expect(settings.defaults.defaultMaxAutoRetries).toBe(2)
    expect(settings.defaults.defaultBatchMode).toBe('independent')
    expect(settings.templates.some((template) => template.id === 'tpl-fast')).toBe(true)
    expect(settings.templates.some((template) => template.id === 'builtin:full-daily')).toBe(true)
    expect(settings.schedules).toHaveLength(1)
    expect(settings.alerts.notifyOnRunFailed).toBe(false)
    expect(settings.alerts.toastNotifications).toBe(true)
  })

  it('returns stable fallback defaults for empty configs', () => {
    const settings = resolveProjectTaskSettings()

    expect(settings.templates.some((template) => template.id === 'builtin:director-repair')).toBe(true)
    expect(settings.schedules).toEqual([])
    expect(settings.defaults.defaultPriority).toBe('normal')
    expect(settings.alerts.notifyOnScheduleTriggered).toBe(true)
  })

  it('allows project templates to override builtin template ids', () => {
    const settings = resolveProjectTaskSettings({
      taskTemplates: [
        {
          id: 'builtin:director-repair',
          label: '项目版导演补跑',
          description: '覆盖内置模板',
          source: 'project',
          startStage: 'director',
          singleStage: true,
          priority: 'low',
          maxAutoRetries: 3,
          batchMode: 'sequential_always'
        }
      ]
    })

    expect(settings.templates.find((template) => template.id === 'builtin:director-repair')).toEqual({
      id: 'builtin:director-repair',
      label: '项目版导演补跑',
      description: '覆盖内置模板',
      source: 'project',
      startStage: 'director',
      singleStage: true,
      priority: 'low',
      maxAutoRetries: 3,
      batchMode: 'sequential_always'
    })
  })
})
