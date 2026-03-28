import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProjectStatePersistence,
  readProjectStateFile,
  recoverPipelineContext,
  type ProjectState
} from './project-state'

const tempDirs: string[] = []

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feicai-project-state-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('project-state runtime recovery', () => {
  it('recovers an interrupted running snapshot as error context', () => {
    const state: ProjectState = {
      version: 2,
      projectId: 'project-1',
      updatedAt: '2026-03-23T00:00:00.000Z',
      episodes: {},
      runtime: {
        status: 'running',
        updatedAt: '2026-03-23T00:00:01.000Z',
        context: {
          runId: 'run-1',
          projectId: 'project-1',
          projectPath: '/tmp/project-1',
          episodeNum: 1,
          currentStage: 'art',
          state: 'art_designing',
          retryCount: 0,
          runStartedAt: '2026-03-23T00:00:00.000Z',
          lastUpdatedAt: '2026-03-23T00:00:01.000Z',
          reviews: [],
          logs: []
        }
      }
    }

    expect(recoverPipelineContext(state)).toMatchObject({
      runId: 'run-1',
      projectId: 'project-1',
      episodeNum: 1,
      currentStage: 'art',
      state: 'error'
    })
  })

  it('keeps paused and terminal snapshots unchanged', () => {
    const pausedState: ProjectState = {
      version: 2,
      projectId: 'project-1',
      updatedAt: '2026-03-23T00:00:00.000Z',
      episodes: {},
      runtime: {
        status: 'paused',
        updatedAt: '2026-03-23T00:00:01.000Z',
        context: {
          runId: 'run-2',
          projectId: 'project-1',
          projectPath: '/tmp/project-1',
          episodeNum: 2,
          currentStage: 'director',
          state: 'paused',
          retryCount: 1,
          runStartedAt: '2026-03-23T00:00:00.000Z',
          lastUpdatedAt: '2026-03-23T00:00:01.000Z',
          reviews: [],
          logs: []
        }
      }
    }

    expect(recoverPipelineContext(pausedState)).toMatchObject({
      episodeNum: 2,
      state: 'paused',
      retryCount: 1
    })
  })
})

describe('ProjectStatePersistence storyboard review loop', () => {
  it('keeps EP01 in storyboard status when storyboard review fails after prompts land', async () => {
    const projectPath = makeProjectDir()
    const persistence = new ProjectStatePersistence(projectPath, 'project-1')
    const failedReview = {
      stage: 'storyboard' as const,
      reviewType: 'business' as const,
      result: 'FAIL' as const,
      passed: false,
      score: 6,
      feedback: '镜头未覆盖本集关键剧情点。',
      issues: [
        {
          severity: 'major' as const,
          description: '缺少高潮段落镜头'
        }
      ],
      createdAt: '2026-03-27T08:10:00.000Z'
    }

    await persistence.load()
    await persistence.updateEpisode(1, {
      status: 'art',
      lastStage: 'art',
      completedStages: ['director', 'art']
    })
    await persistence.appendReview(1, failedReview, 'storyboard')

    expect(persistence.getEpisode(1)).toMatchObject({
      episodeNum: 1,
      status: 'storyboard',
      lastStage: 'storyboard',
      completedStages: ['director', 'art']
    })
    expect(persistence.getEpisode(1)?.reviews).toEqual([failedReview])

    const normalized = await readProjectStateFile(projectPath)
    expect(normalized?.episodes[1]).toMatchObject({
      status: 'storyboard',
      lastStage: 'storyboard',
      completedStages: ['director', 'art']
    })
  })

  it('promotes EP01 to complete only after storyboard review passes', async () => {
    const projectPath = makeProjectDir()
    const persistence = new ProjectStatePersistence(projectPath, 'project-1')
    const passedReview = {
      stage: 'storyboard' as const,
      reviewType: 'business' as const,
      result: 'PASS' as const,
      passed: true,
      score: 9,
      feedback: '分镜结构完整，可进入单集完成态。',
      issues: [],
      createdAt: '2026-03-27T08:15:00.000Z'
    }

    await persistence.load()
    await persistence.updateEpisode(1, {
      status: 'art',
      lastStage: 'art',
      completedStages: ['director', 'art']
    })
    await persistence.appendReview(1, passedReview, 'storyboard')
    await persistence.markStageComplete(1, 'storyboard', [passedReview])

    expect(persistence.getEpisode(1)).toMatchObject({
      episodeNum: 1,
      status: 'complete',
      lastStage: 'storyboard',
      completedStages: ['director', 'art', 'storyboard']
    })
    expect(persistence.getEpisode(1)?.reviews).toHaveLength(1)

    const normalized = await readProjectStateFile(projectPath)
    expect(normalized?.episodes[1]).toMatchObject({
      status: 'complete',
      lastStage: 'storyboard',
      completedStages: ['director', 'art', 'storyboard']
    })
  })
})
