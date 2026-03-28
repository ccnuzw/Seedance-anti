import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureProjectDataCompatibility,
  ensureProjectDataFileSync
} from './project-data-compat'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-project-compat-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('project-data-compat', () => {
  it('migrates legacy project files, writes backups, and emits a report', async () => {
    const projectPath = makeProjectDir()
    await mkdir(join(projectPath, 'outputs', 'artifacts'), { recursive: true })

    writeFileSync(join(projectPath, 'project-config.json'), JSON.stringify({
      projectName: 'Legacy Project',
      totalEpisodes: 12,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-24T00:00:00.000Z',
      runtimeState: {
        activeEpisode: 99
      }
    }, null, 2))

    writeFileSync(join(projectPath, 'adapt-plan.json'), JSON.stringify({
      volumeLabel: '旧版单卷',
      chapterRange: [1, 80],
      targetEpisodes: 18,
      chapterAllocation: '旧版章集分配'
    }, null, 2))

    writeFileSync(join(projectPath, 'outputs', 'pipeline-state.json'), JSON.stringify({
      projectId: 'legacy-project',
      runtime: {
        context: {
          runId: 'run-1',
          projectId: 'legacy-project',
          projectPath,
          episodeNum: 1,
          currentStage: 'art',
          state: 'art_designing',
          retryCount: 0,
          reviews: [],
          logs: []
        }
      },
      episodes: {
        1: {
          episodeNum: 1,
          status: 'art',
          lastStage: 'art',
          completedStages: ['director'],
          reviews: [
            {
              stage: 'art',
              result: 'pass',
              score: 8,
              businessReview: 'ok',
              complianceReview: 'ok',
              createdAt: '2026-03-24T00:00:00.000Z'
            }
          ],
          totalDurationSeconds: 90
        }
      }
    }, null, 2))

    writeFileSync(join(projectPath, 'outputs', 'artifacts', 'manifest.json'), JSON.stringify({
      projectPath,
      artifacts: [
        {
          kind: 'script_episode',
          filePath: 'script/ep001.md'
        }
      ]
    }, null, 2))

    const report = await ensureProjectDataCompatibility(projectPath)

    expect(report.summary.migrated).toBe(4)
    expect(report.summary.errors).toBe(0)

    const savedConfig = JSON.parse(readFileSync(join(projectPath, 'project-config.json'), 'utf-8'))
    expect(savedConfig.version).toBe(1)
    expect(savedConfig.runtimeState).toBeUndefined()

    const savedPlan = JSON.parse(readFileSync(join(projectPath, 'adapt-plan.json'), 'utf-8'))
    expect(savedPlan.version).toBe(1)
    expect(savedPlan.volumes).toHaveLength(1)
    expect(savedPlan.volumes[0].targetEpisodes).toBe(18)

    const savedState = JSON.parse(readFileSync(join(projectPath, 'outputs', 'pipeline-state.json'), 'utf-8'))
    expect(savedState.version).toBe(2)
    expect(savedState.runtime.status).toBe('running')

    const savedManifest = JSON.parse(readFileSync(join(projectPath, 'outputs', 'artifacts', 'manifest.json'), 'utf-8'))
    expect(savedManifest.version).toBe(1)
    expect(savedManifest.artifacts[0].scopeKey).toBe('script_episode:global:script/ep001.md')
    expect(savedManifest.artifacts[0].isCurrent).toBe(true)

    const latestReportPath = join(projectPath, 'outputs', 'system', 'migration-reports', 'project-data-latest.json')
    expect(existsSync(latestReportPath)).toBe(true)

    const configEntry = report.entries.find((entry) => entry.kind === 'projectConfig')
    expect(configEntry?.backupPath).toBeTruthy()
    expect(existsSync(join(projectPath, configEntry!.backupPath!))).toBe(true)
  })

  it('sync migration normalizes legacy flat adapt plans for projection reads', () => {
    const projectPath = makeProjectDir()

    writeFileSync(join(projectPath, 'adapt-plan.json'), JSON.stringify({
      targetEpisodes: 24,
      chapterRange: [1, 120]
    }, null, 2))

    const result = ensureProjectDataFileSync(projectPath, 'adaptPlan')

    expect(result.data).toMatchObject({
      version: 1,
      activeVolumeIndex: 0
    })
    expect((result.data as { volumes: Array<{ targetEpisodes: number }> }).volumes[0].targetEpisodes).toBe(24)
    expect(result.entry.status).toBe('migrated')
  })
})
