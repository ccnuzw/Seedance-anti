import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { PipelineStateMachine } from './state-machine'
import { normalizeProjectConfig } from '@shared/workflow'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) {
        resolve()
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor timeout'))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('PipelineStateMachine', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('单阶段执行完成后停在对应阶段完成态，并写入自定义输出目录的状态文件', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'feicai-state-machine-'))
    tempDirs.push(projectRoot)

    const projectConfig = normalizeProjectConfig({
      projectName: '自定义目录项目',
      totalEpisodes: 1,
      directories: {
        scriptDir: 'custom-script',
        outputsDir: 'custom-outputs',
        reviewsDir: 'custom-reviews'
      }
    })

    const scriptPath = resolveEpisodeArtifactPath(
      projectRoot,
      'script',
      1,
      projectConfig
    )
    mkdirSync(join(projectRoot, 'custom-script'), { recursive: true })
    mkdirSync(join(projectRoot, 'custom-outputs'), { recursive: true })
    writeFileSync(scriptPath, '# EP01\n', 'utf-8')

    const machine = new PipelineStateMachine(projectRoot)
    ;(machine as any).llmProvider = {}
    ;(machine as any).workflowEngine.generateStage = vi.fn().mockResolvedValue({
      stage: 'director',
      outputPath: resolveEpisodeArtifactPath(
        projectRoot,
        'directorAnalysis',
        1,
        projectConfig
      ),
      content: '导演分析内容',
      promptMetrics: { systemChars: 10, userChars: 20 }
    })
    ;(machine as any).workflowEngine.reviewStage = vi.fn().mockResolvedValue({
      stage: 'director',
      review: {
        stage: 'director',
        reviewType: 'business',
        result: 'PASS',
        passed: true,
        score: 8,
        feedback: '通过',
        issues: [],
        createdAt: new Date().toISOString()
      }
    })

    await machine.start({
      projectId: 'project-1',
      projectPath: projectRoot,
      episodeNum: 1,
      projectConfig,
      projectContext: {
        projectName: '自定义目录项目',
        visualStyle: '现实',
        targetMedium: '短剧',
        episodeNumber: 1
      },
      startStage: 'director',
      singleStage: true
    })

    expect(machine.getState()).toBe('director_done')

    const pipelineStatePath = resolveProjectArtifactPath(
      projectRoot,
      'pipelineState',
      projectConfig
    )
    await waitFor(() => {
      if (!existsSync(pipelineStatePath)) return false
      const pipelineState = JSON.parse(
        readFileSync(pipelineStatePath, 'utf-8')
      ) as {
        episodes: Record<string, { status: string }>
      }
      return pipelineState.episodes['1']?.status === 'director'
    })
  })

  it('retry 会从指定阶段继续执行后续阶段', async () => {
    const machine = new PipelineStateMachine('/tmp/skills')
    ;(machine as any).projectContext = {
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      episodeNumber: 1
    }
    ;(machine as any).context = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 1,
      currentStage: 'art',
      state: 'error',
      retryCount: 0,
      reviews: [],
      logs: []
    }
    ;(machine as any).workflowEngine.generateStage = vi
      .fn()
      .mockImplementation(async (stage: string) => ({
        stage,
        outputPath: `/tmp/${stage}.md`,
        content: `${stage} output`,
        promptMetrics: { systemChars: 10, userChars: 20 }
      }))
    ;(machine as any).workflowEngine.reviewStage = vi
      .fn()
      .mockImplementation(async (stage: string) => ({
        stage,
        review: {
          stage,
          reviewType: 'business',
          result: 'PASS',
          passed: true,
          score: 8,
          feedback: '通过',
          issues: [],
          createdAt: new Date().toISOString()
        }
      }))

    await machine.retry('art')

    expect(
      (machine as any).workflowEngine.generateStage
    ).toHaveBeenNthCalledWith(1, 'art', expect.any(Object), expect.any(Object))
    expect(
      (machine as any).workflowEngine.generateStage
    ).toHaveBeenNthCalledWith(
      2,
      'storyboard',
      expect.any(Object),
      expect.any(Object)
    )
    expect(machine.getState()).toBe('episode_complete')
  })

  it('skipReview 会切换完成态并回写阶段状态', () => {
    const machine = new PipelineStateMachine('/tmp/skills')
    const markStageSkipped = vi.fn().mockResolvedValue(undefined)
    const updateEpisodeStatus = vi.fn().mockResolvedValue(undefined)
    ;(machine as any).context = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 3,
      currentStage: 'art',
      state: 'art_reviewing',
      retryCount: 0,
      reviews: [],
      logs: []
    }
    ;(machine as any).statePersistence = {
      markStageSkipped,
      updateEpisodeStatus
    }

    machine.skipReview('art')

    expect(machine.getState()).toBe('art_done')
    expect(markStageSkipped).toHaveBeenCalledWith(3, 'art')
    expect(updateEpisodeStatus).toHaveBeenCalledWith(3, 'art')
  })

  it('waitForCompletion 会在状态进入终止态后 resolve', async () => {
    const machine = new PipelineStateMachine('/tmp/skills')
    ;(machine as any).context = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 1,
      currentStage: 'director',
      state: 'director_analyzing',
      retryCount: 0,
      reviews: [],
      logs: []
    }

    const completion = machine.waitForCompletion()
    ;(machine as any).context.state = 'error'
    machine.emit('stateChanged', { newState: 'error' })

    await expect(completion).resolves.toEqual({
      state: 'error',
      stage: 'director'
    })
  })
})
