import { describe, expect, it } from 'vitest'
import { validateProjectTaskAutomation } from './project-task-validation'

describe('project-task-validation', () => {
  it('reports duplicate ids, missing template references, and invalid daily time', () => {
    const issues = validateProjectTaskAutomation({
      taskTemplates: [
        {
          id: 'tpl-1',
          label: '模板 A',
          priority: 'high',
          maxAutoRetries: 1,
          batchMode: 'independent'
        },
        {
          id: 'tpl-1',
          label: '模板 B',
          priority: 'normal',
          maxAutoRetries: 0,
          batchMode: 'independent'
        }
      ],
      taskSchedules: [
        {
          id: 'sch-1',
          label: '计划 A',
          enabled: true,
          templateId: 'tpl-missing',
          episodeNumbers: [],
          frequency: 'daily',
          timeValue: '25:80'
        },
        {
          id: 'sch-1',
          label: '计划 B',
          enabled: true,
          episodeNumbers: [1, 9],
          frequency: 'once',
          timeValue: 'not-a-date'
        }
      ]
    }, 8)

    expect(issues.some((issue) => issue.message.includes('模板 ID'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('不存在的模板'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('未配置任何集数'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('每日触发时间无效'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('一次性触发时间无效'))).toBe(true)
    expect(issues.some((issue) => issue.message.includes('超出项目总集数'))).toBe(true)
  })

  it('accepts builtin template ids in schedules', () => {
    const issues = validateProjectTaskAutomation({
      taskTemplates: [],
      taskSchedules: [
        {
          id: 'sch-builtin',
          label: '内置模板计划',
          enabled: true,
          templateId: 'builtin:full-daily',
          episodeNumbers: [1, 2],
          frequency: 'daily',
          timeValue: '09:30'
        }
      ]
    }, 12)

    expect(issues.some((issue) => issue.field === 'templateId')).toBe(false)
  })
})
