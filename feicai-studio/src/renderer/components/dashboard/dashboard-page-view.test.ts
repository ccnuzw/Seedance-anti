import { describe, expect, it } from 'vitest'
import { getDashboardStats, getEntryOption } from './dashboard-page-view'

describe('dashboard-page-view', () => {
  it('返回对应入口配置', () => {
    expect(getEntryOption('story')).toMatchObject({
      workflowMode: 'story_to_shortdrama',
      badge: '中段接入'
    })
  })

  it('统计项目数和总集数', () => {
    expect(
      getDashboardStats([
        {
          id: 'p1',
          name: '项目1',
          visualStyle: '现实',
          targetMedium: '短剧',
          projectPath: '/tmp/p1',
          totalEpisodes: 12,
          config: {
            projectName: '项目1',
            totalEpisodes: 12,
            visualStyle: '现实',
            targetMedium: '短剧',
            createdAt: '2026-05-07T00:00:00.000Z'
          },
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z'
        },
        {
          id: 'p2',
          name: '项目2',
          visualStyle: '电影感',
          targetMedium: '短剧',
          projectPath: '/tmp/p2',
          totalEpisodes: 8,
          config: {
            projectName: '项目2',
            totalEpisodes: 8,
            visualStyle: '电影感',
            targetMedium: '短剧',
            createdAt: '2026-05-07T00:00:00.000Z'
          },
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z'
        }
      ])
    ).toEqual({
      projectCount: 2,
      totalEpisodes: 20
    })
  })
})
