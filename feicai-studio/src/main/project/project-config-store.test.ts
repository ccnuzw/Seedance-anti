import { existsSync, mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getProjectConfigPath,
  mergeProjectConfig,
  normalizeProjectConfig,
  PROJECT_CONFIG_VERSION,
  readProjectConfig,
  saveProjectConfig
} from './project-config-store'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-project-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('project-config-store', () => {
  it('normalizes persisted project config and ignores runtime-only noise', () => {
    const config = normalizeProjectConfig({
      projectName: 'Demo',
      sourceType: 'novel',
      phase: 'writing',
      templateProfileId: 'preset:novel-stable',
      exportProfileId: 'export:delivery-bundle',
      totalEpisodes: 12,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-23T00:00:00.000Z',
      pipelineSettings: {
        maxRetries: 4,
        llmTimeoutSec: 120
      },
      runtimeState: {
        totalEpisodes: 99
      }
    })

    expect(config).toEqual({
      version: PROJECT_CONFIG_VERSION,
      projectName: 'Demo',
      sourceType: 'novel',
      phase: 'writing',
      templateProfileId: 'preset:novel-stable',
      exportProfileId: 'export:delivery-bundle',
      totalEpisodes: 12,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-23T00:00:00.000Z',
      pipelineSettings: {
        maxRetries: 4,
        llmTimeoutSec: 120
      }
    })
  })

  it('merges nested project settings instead of replacing them wholesale', () => {
    const config = mergeProjectConfig(
      {
        projectName: 'Demo',
        totalEpisodes: 12,
        visualStyle: '写实',
        targetMedium: '短剧',
        createdAt: '2026-03-23T00:00:00.000Z',
        pipelineSettings: {
          maxRetries: 3,
          passScore: 7
        },
        reviewPolicy: {
          qaMode: 'strict',
          breakdownAutoRepairRounds: 2
        }
      },
      {
        pipelineSettings: {
          passScore: 8
        },
        reviewPolicy: {
          scriptAutoRepairRounds: 1
        }
      }
    )

    expect(config.pipelineSettings).toEqual({
      maxRetries: 3,
      passScore: 8
    })
    expect(config.reviewPolicy).toEqual({
      qaMode: 'strict',
      breakdownAutoRepairRounds: 2,
      scriptAutoRepairRounds: 1
    })
  })

  it('keeps automation templates, schedules and alert toggles in normalized config', () => {
    const config = normalizeProjectConfig({
      projectName: 'Demo',
      totalEpisodes: 12,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-23T00:00:00.000Z',
      taskTemplates: [
        {
          id: 'tpl-fast',
          label: '快速补跑',
          description: '项目自定义模板',
          source: 'project',
          startStage: 'art',
          singleStage: true,
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
          templateId: 'tpl-fast',
          episodeNumbers: [1, 2, 2, 3],
          frequency: 'daily',
          timeValue: '09:30'
        }
      ],
      taskAlerts: {
        notifyOnRunFailed: false,
        toastNotifications: true
      }
    })

    expect(config.taskTemplates).toEqual([
      {
        id: 'tpl-fast',
        label: '快速补跑',
        description: '项目自定义模板',
        source: 'project',
        startStage: 'art',
        singleStage: true,
        priority: 'high',
        maxAutoRetries: 2,
        batchMode: 'sequential_on_success'
      }
    ])
    expect(config.taskSchedules).toEqual([
      {
        id: 'sch-daily',
        label: '日报回填',
        enabled: true,
        templateId: 'tpl-fast',
        episodeNumbers: [1, 2, 2, 3],
        frequency: 'daily',
        timeValue: '09:30'
      }
    ])
    expect(config.taskAlerts).toEqual({
      notifyOnRunFailed: false,
      toastNotifications: true
    })
  })

  it('persists novel binding and episode outlines to disk across incremental saves', async () => {
    const projectDir = makeProjectDir()

    await saveProjectConfig(projectDir, {
      projectName: '夜雨项目',
      sourceType: 'novel',
      phase: 'writing',
      totalEpisodes: 8,
      visualStyle: '写实',
      targetMedium: '短剧',
      novelTitle: '夜雨来信',
      novelGenre: '悬疑',
      originalContent: {
        title: '夜雨来信',
        genre: '悬疑',
        sourcePath: '/tmp/night-rain.txt',
        contentFormat: 'text'
      },
      episodeOutlines: [
        { episodeNumber: 2, title: '第二集', summary: '第二集摘要' },
        { episodeNumber: 1, title: '第一集', summary: '第一集摘要' }
      ],
      pipelineSettings: {
        maxRetries: 3
      }
    })

    await saveProjectConfig(projectDir, {
      totalEpisodes: 10,
      pipelineSettings: {
        passScore: 9
      },
      reviewPolicy: {
        qaMode: 'strict'
      }
    })

    const saved = await readProjectConfig(projectDir)

    expect(existsSync(getProjectConfigPath(projectDir))).toBe(true)
    expect(saved).toMatchObject({
      projectName: '夜雨项目',
      sourceType: 'novel',
      phase: 'writing',
      totalEpisodes: 10,
      novelTitle: '夜雨来信',
      novelGenre: '悬疑',
      originalContent: {
        title: '夜雨来信',
        genre: '悬疑',
        sourcePath: '/tmp/night-rain.txt',
        contentFormat: 'text'
      },
      pipelineSettings: {
        maxRetries: 3,
        passScore: 9
      },
      reviewPolicy: {
        qaMode: 'strict'
      }
    })
    expect(saved?.episodeOutlines).toEqual([
      { episodeNumber: 1, title: '第一集', summary: '第一集摘要' },
      { episodeNumber: 2, title: '第二集', summary: '第二集摘要' }
    ])
  })
})
