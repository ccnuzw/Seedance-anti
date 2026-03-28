import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  userDataPath: ''
}))

const require = createRequire(import.meta.url)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unsupported electron app path: ${name}`)
      }
      return electronState.userDataPath
    },
    isPackaged: false
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

function hasNativeBetterSqliteBinding(): boolean {
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const probeDir = mkdtempSync(join(tmpdir(), 'feicai-sqlite-probe-'))
    const probePath = join(probeDir, 'probe.db')
    const db = new Database(probePath)
    db.close()
    tempDirs.push(probeDir)
    return true
  } catch {
    return false
  }
}

const tempDirs: string[] = []
const nativeBetterSqliteReady = hasNativeBetterSqliteBinding()
const managers: Array<{
  automationTimer?: NodeJS.Timeout | null
  queueWakeTimer?: NodeJS.Timeout | null
  recoveryTimer?: NodeJS.Timeout | null
  heartbeatTimer?: NodeJS.Timeout | null
}> = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function trackManager<T extends {
  automationTimer?: NodeJS.Timeout | null
  queueWakeTimer?: NodeJS.Timeout | null
  recoveryTimer?: NodeJS.Timeout | null
  heartbeatTimer?: NodeJS.Timeout | null
}>(manager: T): T {
  managers.push(manager)
  return manager
}

function disposeManager(manager: {
  automationTimer?: NodeJS.Timeout | null
  queueWakeTimer?: NodeJS.Timeout | null
  recoveryTimer?: NodeJS.Timeout | null
  heartbeatTimer?: NodeJS.Timeout | null
}): void {
  if (manager.automationTimer) {
    clearInterval(manager.automationTimer)
    manager.automationTimer = null
  }

  if (manager.queueWakeTimer) {
    clearTimeout(manager.queueWakeTimer)
    manager.queueWakeTimer = null
  }

  if (manager.recoveryTimer) {
    clearInterval(manager.recoveryTimer)
    manager.recoveryTimer = null
  }

  if (manager.heartbeatTimer) {
    clearInterval(manager.heartbeatTimer)
    manager.heartbeatTimer = null
  }
}

afterEach(async () => {
  managers.splice(0).forEach(disposeManager)
  if (nativeBetterSqliteReady) {
    const { closeDatabase } = await import('../db/database')
    closeDatabase()
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pipeline runtime manager integration', () => {
  const integrationTest = nativeBetterSqliteReady ? it : it.skip

  integrationTest('restores queued batch runs from sqlite and exposes diagnostics', async () => {
    const [{ initDatabase }, { createProject }, { saveProjectConfigSync }, { PipelineRuntimeManager }] =
      await Promise.all([
        import('../db/database'),
        import('../db/queries'),
        import('../project/project-config-store'),
        import('./pipeline-runtime-manager')
      ])

    electronState.userDataPath = makeTempDir('feicai-runtime-userdata-')
    initDatabase()

    const projectDir = makeTempDir('feicai-runtime-project-')
    const futureScheduleTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    saveProjectConfigSync(projectDir, {
      projectName: '批次恢复验证',
      totalEpisodes: 2,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-24T00:00:00.000Z',
      taskSchedules: [
        {
          id: 'sch-future',
          label: '未来补跑',
          enabled: true,
          templateId: 'tpl-missing',
          episodeNumbers: [1, 3],
          frequency: 'once',
          timeValue: futureScheduleTime
        }
      ]
    })

    const project = createProject({
      name: '占位项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath: projectDir,
      totalEpisodes: 2,
      config: {}
    })

    const manager = trackManager(new PipelineRuntimeManager())
    await (manager as InstanceType<typeof PipelineRuntimeManager> & { queueReady: Promise<void> }).queueReady

    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const baseContext = {
      projectName: project.name,
      visualStyle: project.visualStyle,
      targetMedium: project.targetMedium,
      episodeNumber: 1
    }

    const firstRun = await manager.enqueue({
      projectId: project.id,
      projectPath: project.projectPath,
      episodeNum: 1,
      projectContext: {
        ...baseContext,
        episodeNumber: 1
      },
      strategy: {
        batchId: 'batch-restore',
        batchLabel: '恢复验证批次',
        priority: 'high',
        maxAutoRetries: 1,
        templateLabel: '恢复模板'
      },
      orchestration: {
        scheduledAt
      }
    })

    const secondRun = await manager.enqueue({
      projectId: project.id,
      projectPath: project.projectPath,
      episodeNum: 2,
      projectContext: {
        ...baseContext,
        episodeNumber: 2
      },
      strategy: {
        batchId: 'batch-restore',
        batchLabel: '恢复验证批次',
        priority: 'normal',
        maxAutoRetries: 1,
        templateLabel: '恢复模板'
      },
      orchestration: {
        dependsOnRootRunId: firstRun.rootRunId,
        condition: 'on_success',
        scheduledAt
      }
    })

    const restoredManager = trackManager(new PipelineRuntimeManager())
    await (restoredManager as InstanceType<typeof PipelineRuntimeManager> & { queueReady: Promise<void> }).queueReady

    const diagnostics = restoredManager.getDiagnostics()

    expect(diagnostics.queueSummary).toEqual({
      total: 2,
      waitingForSchedule: 2,
      waitingForDependency: 1,
      deadLetter: 0
    })
    expect(diagnostics.queue.map((item) => ({
      episodeNum: item.episodeNum,
      queuePosition: item.queuePosition,
      priority: item.priority,
      dependsOnRootRunId: item.dependsOnRootRunId
    }))).toEqual([
      {
        episodeNum: 1,
        queuePosition: 1,
        priority: 'high',
        dependsOnRootRunId: undefined
      },
      {
        episodeNum: 2,
        queuePosition: 2,
        priority: 'normal',
        dependsOnRootRunId: firstRun.rootRunId
      }
    ])
    expect(diagnostics.automation.projectCount).toBe(1)
    expect(diagnostics.automation.enabledScheduleCount).toBe(1)
    expect(diagnostics.automation.nextQueueWakeAt).toBe(scheduledAt)
    expect(diagnostics.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        scope: 'schedule',
        id: 'sch-future',
        field: 'templateId'
      }),
      expect.objectContaining({
        severity: 'warning',
        scope: 'schedule',
        id: 'sch-future',
        field: 'episodeNumbers'
      })
    ]))

    const persistedRuns = restoredManager.listRuns(project.id, 10)
    expect(persistedRuns).toHaveLength(2)
    expect(persistedRuns.every((run) => run.status === 'queued')).toBe(true)

    const runDetail = restoredManager.getRunDetail(secondRun.runId)
    expect(runDetail?.run.dependsOnRootRunId).toBe(firstRun.rootRunId)
    expect(runDetail?.logs).toEqual([])

  })

  integrationTest('dead-letters orphaned running tasks during startup recovery sweep', async () => {
    const [{ initDatabase }, { createProject, upsertPipelineRun, updatePipelineRunPayload, getPipelineRun }, { saveProjectConfigSync }, { PipelineRuntimeManager }] =
      await Promise.all([
        import('../db/database'),
        import('../db/queries'),
        import('../project/project-config-store'),
        import('./pipeline-runtime-manager')
      ])

    electronState.userDataPath = makeTempDir('feicai-runtime-userdata-')
    initDatabase()

    const projectDir = makeTempDir('feicai-runtime-project-')
    saveProjectConfigSync(projectDir, {
      projectName: '孤儿任务恢复验证',
      totalEpisodes: 1,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-24T00:00:00.000Z'
    })

    const project = createProject({
      name: '孤儿任务恢复验证',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath: projectDir,
      totalEpisodes: 1,
      config: {}
    })

    upsertPipelineRun({
      runId: 'run-orphaned',
      projectId: project.id,
      projectPath: project.projectPath,
      episodeNum: 1,
      currentStage: 'director',
      status: 'running',
      state: 'director_analyzing',
      singleStage: false,
      queuedAt: '2026-03-24T00:00:00.000Z',
      startedAt: '2026-03-24T00:00:05.000Z',
      lastUpdatedAt: '2026-03-24T00:00:10.000Z',
      priority: 'normal',
      maxAutoRetries: 0,
      attempt: 0,
      rootRunId: 'run-orphaned',
      triggerCondition: 'always'
    })
    updatePipelineRunPayload('run-orphaned', {
      projectId: project.id,
      projectPath: project.projectPath,
      episodeNum: 1,
      projectContext: {
        projectName: project.name,
        visualStyle: project.visualStyle,
        targetMedium: project.targetMedium,
        episodeNumber: 1
      }
    })

    const manager = trackManager(new PipelineRuntimeManager())
    await (manager as InstanceType<typeof PipelineRuntimeManager> & { queueReady: Promise<void> }).queueReady

    const run = getPipelineRun('run-orphaned')
    expect(run?.status).toBe('dead_letter')
    expect(run?.recoveryNote).toContain('任务已转入死信')

    const diagnostics = manager.getDiagnostics()
    expect(diagnostics.queueSummary.deadLetter).toBe(1)
    expect(diagnostics.recovery.deadLetterCount).toBe(1)
    expect(diagnostics.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'recovery',
        field: 'deadLetter',
        id: 'run-orphaned'
      })
    ]))
  })

  integrationTest('manually triggers schedule batches and resolves builtin templates', async () => {
    const [{ initDatabase }, { createProject }, { saveProjectConfigSync }, { PipelineRuntimeManager }] =
      await Promise.all([
        import('../db/database'),
        import('../db/queries'),
        import('../project/project-config-store'),
        import('./pipeline-runtime-manager')
      ])

    electronState.userDataPath = makeTempDir('feicai-runtime-userdata-')
    initDatabase()

    const projectDir = makeTempDir('feicai-runtime-project-')
    saveProjectConfigSync(projectDir, {
      projectName: '内置模板调度验证',
      totalEpisodes: 3,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-03-24T00:00:00.000Z',
      taskSchedules: [
        {
          id: 'sch-builtin',
          label: '导演补跑计划',
          enabled: true,
          templateId: 'builtin:director-repair',
          episodeNumbers: [1, 2],
          frequency: 'daily',
          timeValue: '09:30'
        }
      ]
    })

    const project = createProject({
      name: '内置模板调度验证',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath: projectDir,
      totalEpisodes: 3,
      config: {}
    })

    const manager = trackManager(new PipelineRuntimeManager())
    await (manager as InstanceType<typeof PipelineRuntimeManager> & { queueReady: Promise<void> }).queueReady

    const runs = await manager.triggerProjectSchedule(project.id, 'sch-builtin')

    expect(runs).toHaveLength(2)
    expect(runs.map((run) => ({
      episodeNum: run.episodeNum,
      scheduleLabel: run.scheduleLabel,
      templateLabel: run.templateLabel,
      currentStage: run.currentStage,
      scheduledAt: run.scheduledAt
    }))).toEqual([
      {
        episodeNum: 1,
        scheduleLabel: '导演补跑计划',
        templateLabel: '内置 · 导演补跑',
        currentStage: 'director',
        scheduledAt: undefined
      },
      {
        episodeNum: 2,
        scheduleLabel: '导演补跑计划',
        templateLabel: '内置 · 导演补跑',
        currentStage: 'director',
        scheduledAt: undefined
      }
    ])
  })

  integrationTest('aggregates llm telemetry into run detail and runtime diagnostics', async () => {
    const [{ initDatabase }, { createProject, savePipelineRunLLMCall, upsertPipelineRun }, { PipelineRuntimeManager }] =
      await Promise.all([
        import('../db/database'),
        import('../db/queries'),
        import('./pipeline-runtime-manager')
      ])

    electronState.userDataPath = makeTempDir('feicai-runtime-userdata-')
    initDatabase()

    const projectDir = makeTempDir('feicai-runtime-project-')
    const project = createProject({
      name: '遥测聚合验证',
      visualStyle: '写实',
      targetMedium: '短剧',
      projectPath: projectDir,
      totalEpisodes: 1,
      config: {}
    })

    upsertPipelineRun({
      runId: 'run-telemetry',
      projectId: project.id,
      projectPath: project.projectPath,
      episodeNum: 1,
      currentStage: 'director',
      status: 'failed',
      state: 'error',
      singleStage: false,
      queuedAt: '2026-03-24T00:00:00.000Z',
      startedAt: '2026-03-24T00:00:05.000Z',
      endedAt: '2026-03-24T00:00:30.000Z',
      lastUpdatedAt: '2026-03-24T00:00:30.000Z',
      priority: 'normal',
      maxAutoRetries: 1,
      attempt: 0,
      rootRunId: 'run-telemetry',
      triggerCondition: 'always'
    })

    savePipelineRunLLMCall('run-telemetry', {
      stage: 'director',
      phase: 'stage_execution',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'success',
      stream: true,
      startedAt: '2026-03-24T00:00:05.000Z',
      endedAt: '2026-03-24T00:00:08.000Z',
      durationMs: 3000,
      usage: {
        inputTokens: 1200,
        outputTokens: 400,
        totalTokens: 1600,
        tokenSource: 'actual'
      },
      estimatedCostUsd: 0.0014
    })

    savePipelineRunLLMCall('run-telemetry', {
      stage: 'director',
      phase: 'business_review',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'failed',
      stream: false,
      startedAt: '2026-03-24T00:00:10.000Z',
      endedAt: '2026-03-24T00:00:12.000Z',
      durationMs: 2000,
      usage: {
        inputTokens: 300,
        outputTokens: 0,
        totalTokens: 300,
        tokenSource: 'estimated'
      },
      estimatedCostUsd: 0.00015,
      failureClass: 'timeout',
      errorMessage: 'LLM 请求超时'
    })

    const manager = trackManager(new PipelineRuntimeManager())
    await (manager as InstanceType<typeof PipelineRuntimeManager> & { queueReady: Promise<void> }).queueReady

    const detail = manager.getRunDetail('run-telemetry')
    expect(detail?.llmCalls).toHaveLength(2)
    expect(detail?.run.telemetry).toEqual(expect.objectContaining({
      callCount: 2,
      successCount: 1,
      failureCount: 1,
      totalTokens: 1900,
      estimatedCostUsd: 0.00155,
      lastFailureClass: 'timeout'
    }))

    const diagnostics = manager.getDiagnostics()
    expect(diagnostics.telemetry).toEqual(expect.objectContaining({
      callCount: 2,
      successCount: 1,
      failureCount: 1,
      totalTokens: 1900
    }))
  })
})
