import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ProjectConfig, ProjectPipelineState } from '@shared/types'
import { buildDefaultPlotBreakdownTemplate } from '@shared/project-bootstrap'
import { normalizeProjectConfig } from '@shared/project-config'
import {
  summarizeProjectPlotBreakdown,
  readPlotBreakdown
} from '../project/plot-breakdown-store'
import { IPC } from '@shared/ipc-channels'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'

const runtime = vi.hoisted(() => {
  const frame = { url: 'file:///integration/index.html' }
  const sender = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false
  }
  return {
    directory: '',
    frame,
    sender,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    saveDialog: vi.fn(),
    generate: vi.fn(),
    stream: vi.fn(),
    worker: vi.fn()
  }
})
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData' || !runtime.directory)
        throw new Error('Temporary userData only')
      return runtime.directory
    }
  },
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
      runtime.handlers.set(channel, callback)
  },
  BrowserWindow: {
    fromWebContents: (sender: unknown) =>
      sender === runtime.sender ? { id: 1 } : null
  },
  dialog: { showSaveDialog: runtime.saveDialog }
}))
// SQL and files are real; only the driver API is adapted to the Node ABI.
vi.mock('better-sqlite3', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  return {
    default: class extends DatabaseSync {
      pragma(sql: string) {
        return this.prepare(`PRAGMA ${sql}`).all()
      }
      transaction<T>(callback: () => T) {
        return () => {
          this.exec('BEGIN')
          try {
            const result = callback()
            this.exec('COMMIT')
            return result
          } catch (error) {
            this.exec('ROLLBACK')
            throw error
          }
        }
      }
    }
  }
})
// The bundled worker URL is not executed by this service/IPC regression.
vi.mock('../workers/project-sync-worker?modulePath', () => ({ default: '' }))
vi.mock('../db/episode-sync-worker', async () => ({
  invalidateProjectScanCache: vi.fn(),
  runProjectSyncWorker: async (data: {
    mode: string
    projectPath: string
    config: ProjectConfig
    episodeNumber: number
    totalEpisodes: number
  }) => {
    const { scanEpisodeFilesystem, scanProjectFilesystem } =
      await import('../project-sync/scan')
    const hasSourceNovel = existsSync(
      resolveProjectArtifactPath(data.projectPath, 'sourceNovel', data.config)
    )
    const result =
      data.mode === 'episode'
        ? {
            hasSourceNovel,
            episode: scanEpisodeFilesystem(
              data.projectPath,
              data.config,
              data.episodeNumber,
              hasSourceNovel
            )
          }
        : scanProjectFilesystem(
            data.projectPath,
            data.config,
            data.totalEpisodes
          )
    await runtime.worker(data)
    return result
  }
}))
vi.mock('../db/llm-config-repository', () => ({
  getDefaultLLMConfig: () => ({ model: 'controlled-no-network' })
}))
vi.mock('../llm/provider-factory', () => ({
  createProvider: () => ({
    generate: runtime.generate,
    generateStream: runtime.stream
  })
}))
import { initDatabase, closeDatabase } from '../db/database'
import { insertProjectRecord } from '../db/project-repository'
import { PipelineStateMachine } from '../engine/state-machine'
import { isReviewCurrent } from '../engine/artifact-provenance'
import { WorkflowStepRunner } from '../workflow/workflow-step-runner'
import {
  art,
  pass,
  script,
  storyboard
} from '@shared/fixtures/controlled-production'
import { launchPipeline, runWorkflowAction } from './pipeline-service'
import {
  acquireExecutionLease,
  getExecutionLease,
  releaseExecutionLease
} from './batch-execution-lease'
import { registerExportHandlers } from '../ipc/export-handlers'
import { registerAssetHandlers } from '../ipc/asset-handlers'
import {
  registerProjectRoot,
  resetAccessControl
} from '../security/access-control'
import { setTrustedIpcRendererUrl } from '../security/safe-ipc'
import { flushPendingWrites } from '../io/atomic-file'
import {
  ProductionCommitStore,
  commitHash
} from '../io/production-commit-store'
import {
  syncFreshProductionEpisodes,
  syncSingleEpisodeStatus
} from '../db/episode-sync-repository'
import {
  recoverProductionCommits,
  recoverProjectCommits,
  recoverProjectSettingsCommits
} from './production-commit-service'
import { saveProjectSettings, projectSettingsRecord } from './project-service'
import { getProject } from '../db/project-repository'
import { updatePlotBreakdownPlanning } from '@shared/plot-breakdown'

let root: string
function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return runtime.handlers.get(channel)!(
    { sender: runtime.sender, senderFrame: runtime.frame },
    ...args
  )
}
beforeEach(() => {
  runtime.directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'feicai-production-integration-'))
  )
  root = join(runtime.directory, 'project')
  mkdirSync(root)
  initDatabase()
  resetAccessControl()
  registerProjectRoot(root)
  setTrustedIpcRendererUrl(runtime.frame.url)
  runtime.handlers.clear()
  runtime.generate.mockReset()
  runtime.stream.mockReset()
  runtime.worker.mockReset()
  runtime.saveDialog.mockReset()
  registerExportHandlers()
  registerAssetHandlers()
})
afterEach(async () => {
  const lease = getExecutionLease()
  if (lease) releaseExecutionLease(lease)
  await flushPendingWrites()
  closeDatabase()
  resetAccessControl()
  rmSync(runtime.directory, { recursive: true, force: true })
  runtime.directory = ''
})

describe('registered project → workflow service → automatic pipeline → asset/export IPC', () => {
  it.each([
    'prepared',
    'installed:0',
    'installed:1',
    'committed',
    'projection',
    'receipt'
  ])(
    'recovers settings files and SQLite projection after %s',
    async (boundary) => {
      const projectPath = join(root, `settings-${boundary.replace(':', '-')}`)
      mkdirSync(projectPath)
      const config: ProjectConfig = {
        projectName: '设置前',
        entryStage: 'script',
        totalEpisodes: 2,
        chaptersPerEpisode: 3,
        visualStyle: '写实',
        targetMedium: '短剧',
        createdAt: '2026-01-01'
      }
      const id = `settings-${boundary}`
      insertProjectRecord(initDatabase(), {
        id,
        name: config.projectName,
        projectPath,
        visualStyle: config.visualStyle,
        targetMedium: config.targetMedium,
        totalEpisodes: config.totalEpisodes,
        configJson: JSON.stringify(config),
        createdAt: config.createdAt,
        updatedAt: config.createdAt
      })
      const current = getProject(id)!
      const configPath = resolveProjectArtifactPath(
        projectPath,
        'projectConfig',
        config
      )
      const plotPath = resolveProjectArtifactPath(
        projectPath,
        'plotBreakdown',
        config
      )
      const oldConfigText = JSON.stringify(config, null, 2)
      const oldPlotText = 'old planning'
      const nextConfig = normalizeProjectConfig({
        ...config,
        projectName: '设置后',
        totalEpisodes: 4,
        directories: {
          ...config.directories,
          assetsDir: 'recovered-assets',
          scriptDir: 'recovered-script'
        }
      })
      const nextConfigText = JSON.stringify(nextConfig, null, 2)
      put(configPath, oldConfigText)
      put(plotPath, oldPlotText)
      const projection = {
        projectId: id,
        projectPath,
        previous: {
          name: current.name,
          visualStyle: current.visualStyle,
          targetMedium: current.targetMedium,
          totalEpisodes: current.totalEpisodes,
          configJson: JSON.stringify(current.config),
          updatedAt: current.updatedAt
        },
        next: {
          name: nextConfig.projectName,
          visualStyle: nextConfig.visualStyle,
          targetMedium: nextConfig.targetMedium,
          totalEpisodes: nextConfig.totalEpisodes,
          configJson: JSON.stringify(nextConfig),
          updatedAt: '2026-02-01T00:00:00.000Z'
        }
      }
      const store = new ProductionCommitStore(projectPath, config, (point) => {
        if (point === boundary) throw new Error('simulated crash')
      })
      const intent = await store.intent(
        `op-${boundary}`,
        'settings',
        commitHash(nextConfigText),
        [],
        [configPath, plotPath],
        'project-settings'
      )
      if (boundary !== 'intent') {
        if (boundary === 'prepared') {
          await expect(
            store.prepare(
              intent,
              [
                {
                  path: configPath,
                  expected: oldConfigText,
                  content: nextConfigText
                },
                {
                  path: plotPath,
                  expected: oldPlotText,
                  content: 'new planning'
                }
              ],
              projection
            )
          ).rejects.toThrow('simulated crash')
        } else {
          const prepared = await store.prepare(
            intent,
            [
              {
                path: configPath,
                expected: oldConfigText,
                content: nextConfigText
              },
              { path: plotPath, expected: oldPlotText, content: 'new planning' }
            ],
            projection
          )
          if (boundary === 'projection' || boundary === 'receipt') {
            await store.install(prepared)
            await expect(
              store.recover(projectSettingsRecord, 'project-settings')
            ).rejects.toThrow('simulated crash')
          } else {
            await expect(store.install(prepared)).rejects.toThrow(
              'simulated crash'
            )
          }
        }
      }

      const nameBeforeProductionRecovery = getProject(id)?.name
      await recoverProjectCommits(
        'production',
        projectPath,
        config,
        undefined,
        id
      )
      expect(getProject(id)?.name).toBe(nameBeforeProductionRecovery)
      expect(
        new ProductionCommitStore(projectPath, config).list('project-settings')
      ).toHaveLength(1)
      await recoverProjectSettingsCommits(projectPath, config, undefined, id)
      await recoverProjectSettingsCommits(projectPath, config, undefined, id)
      expect(readFileSync(configPath, 'utf8')).toBe(nextConfigText)
      expect(readFileSync(plotPath, 'utf8')).toBe('new planning')
      expect(existsSync(join(projectPath, 'recovered-assets'))).toBe(true)
      expect(existsSync(join(projectPath, 'recovered-script'))).toBe(true)
      expect(getProject(id)).toMatchObject({
        name: nextConfig.projectName,
        totalEpisodes: nextConfig.totalEpisodes,
        updatedAt: projection.next.updatedAt,
        config: { projectName: nextConfig.projectName }
      })
      expect(
        new ProductionCommitStore(projectPath, config).list('project-settings')
      ).toMatchObject([{ phase: 'committed', projected: true }])
    }
  )

  it('commits settings, existing plot planning, and the SQLite projection together under one lease', async () => {
    const config: ProjectConfig = {
      projectName: '设置前',
      entryStage: 'script',
      totalEpisodes: 2,
      chaptersPerEpisode: 3,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-01-01',
      directories: { outputsDir: 'custom-output' }
    }
    const db = initDatabase()
    insertProjectRecord(db, {
      id: 'settings',
      name: config.projectName,
      projectPath: root,
      visualStyle: config.visualStyle,
      targetMedium: config.targetMedium,
      totalEpisodes: config.totalEpisodes,
      configJson: JSON.stringify(config),
      createdAt: config.createdAt,
      updatedAt: config.createdAt
    })
    const configPath = resolveProjectArtifactPath(root, 'projectConfig', config)
    const plotPath = resolveProjectArtifactPath(root, 'plotBreakdown', config)
    put(configPath, JSON.stringify(config, null, 2))
    const originalPlot =
      '# 剧情规划\n\n项目名称：设置前\n项目类型：短剧\n总集数：2\n每集章节数：3\n'
    put(plotPath, originalPlot)

    const lease = acquireExecutionLease('test-settings')
    try {
      const updated = await saveProjectSettings('settings', {
        name: '设置后',
        visualStyle: '写实',
        targetMedium: '短剧',
        totalEpisodes: 4,
        config: {
          chaptersPerEpisode: 5,
          directories: {
            assetsDir: 'updated-assets',
            scriptDir: 'updated-script'
          }
        }
      })
      expect(getExecutionLease()).toBe(lease)
      expect(updated.name).toBe('设置后')
      expect(getProject('settings')).toMatchObject({
        name: '设置后',
        totalEpisodes: 4,
        config: {
          projectName: '设置后',
          chaptersPerEpisode: 5,
          directories: {
            assetsDir: 'updated-assets',
            scriptDir: 'updated-script'
          }
        }
      })
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toMatchObject({
        projectName: '设置后',
        totalEpisodes: 4,
        chaptersPerEpisode: 5
      })
      expect(readFileSync(plotPath, 'utf8')).toBe(
        updatePlotBreakdownPlanning(originalPlot, {
          projectName: '设置后',
          projectType: '短剧',
          totalEpisodes: 4,
          chaptersPerEpisode: 5
        })
      )
      expect(
        new ProductionCommitStore(root, config).list('project-settings')
      ).toMatchObject([{ phase: 'committed', projected: true }])
      expect(existsSync(join(root, 'updated-assets'))).toBe(true)
      expect(existsSync(join(root, 'updated-script'))).toBe(true)
    } finally {
      releaseExecutionLease(lease)
    }
  })

  it('drains an older scan, projects to disk SQLite, and recovers after projection before its receipt under the same lease', async () => {
    const config: ProjectConfig = {
      projectName: '恢复',
      entryStage: 'script',
      totalEpisodes: 1,
      chaptersPerEpisode: 1,
      visualStyle: '写实',
      targetMedium: '短剧',
      createdAt: '2026-01-01',
      directories: { outputsDir: 'custom-output' }
    }
    const db = initDatabase()
    insertProjectRecord(db, {
      id: 'recovery',
      name: config.projectName,
      projectPath: root,
      visualStyle: config.visualStyle,
      targetMedium: config.targetMedium,
      totalEpisodes: 1,
      configJson: JSON.stringify(config),
      createdAt: config.createdAt,
      updatedAt: config.createdAt
    })
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    runtime.worker.mockImplementationOnce(async () => {
      entered.resolve()
      await resume.promise
    })
    const oldScan = syncSingleEpisodeStatus('recovery', root, 1)
    await entered.promise
    const store = new ProductionCommitStore(root, config, (point) => {
      if (point === 'projection') throw new Error('receipt crash')
    })
    const intent = await store.intent(
      'disk-operation',
      'script:1',
      commitHash(script),
      [1]
    )
    const record = await store.prepare(intent, [
      {
        path: resolveEpisodeArtifactPath(root, 'script', 1, config),
        expected: null,
        content: script
      }
    ])
    const lease = acquireExecutionLease('test-production')
    try {
      let finished = false
      const recovering = store
        .recover((episodes) => {
          expect(getExecutionLease()).toBe(lease)
          return syncFreshProductionEpisodes('recovery', root, episodes)
        })
        .finally(() => {
          finished = true
        })
      await vi.waitFor(() =>
        expect(store.get(record.operationId, record.key)?.phase).toBe(
          'committed'
        )
      )
      expect(finished).toBe(false)
      expect(runtime.worker).toHaveBeenCalledTimes(1)
      await expect(recoverProductionCommits(root, config)).rejects.toThrow()
      resume.resolve()
      await oldScan
      await expect(recovering).rejects.toThrow('receipt crash')
      const row = db
        .prepare('SELECT id, has_script FROM episodes WHERE project_id = ?')
        .get('recovery') as { id: string; has_script: number }
      expect(row.has_script).toBe(1)
      expect(store.get(record.operationId, record.key)?.projected).toBe(false)
      const databases = db.prepare('PRAGMA database_list').all() as {
        file: string
      }[]
      expect(readFileSync(databases[0].file).subarray(0, 16).toString()).toBe(
        'SQLite format 3\u0000'
      )
      closeDatabase()
      initDatabase()
      await recoverProductionCommits(root, config, lease, 'recovery')
      await recoverProductionCommits(root, config, lease, 'recovery')
      expect(
        new ProductionCommitStore(root, config).get(
          record.operationId,
          record.key
        )?.projected
      ).toBe(true)
      expect(
        initDatabase()
          .prepare('SELECT id, has_script FROM episodes WHERE project_id = ?')
          .get('recovery')
      ).toEqual(row)
      expect(runtime.generate).not.toHaveBeenCalled()
      expect(runtime.stream).not.toHaveBeenCalled()
    } finally {
      resume.resolve()
      releaseExecutionLease(lease)
    }
  })

  it.each(['current', 'legacy'] as const)(
    '%s empty bootstrap starts at batch 1 / chapters 1–6, recovers publication, then consumes once',
    async (template) => {
      const config: ProjectConfig = {
        projectName: '空模板联验',
        entryStage: 'novel',
        totalEpisodes: 2,
        chaptersPerEpisode: 6,
        visualStyle: '写实',
        targetMedium: '短剧',
        createdAt: '2026-01-01',
        pipelineSettings: { scriptWordCountMin: 1, scriptWordCountMax: 5000 },
        directories: {
          sourceDir: 'custom/source',
          outputsDir: 'custom/output',
          reviewsDir: 'custom/reviews'
        }
      }
      insertProjectRecord(initDatabase(), {
        id: 'bootstrap',
        name: config.projectName,
        projectPath: root,
        visualStyle: config.visualStyle,
        targetMedium: config.targetMedium,
        totalEpisodes: config.totalEpisodes,
        configJson: JSON.stringify(config),
        createdAt: config.createdAt,
        updatedAt: config.createdAt
      })
      const projectPath = (
        artifact: Parameters<typeof resolveProjectArtifactPath>[1]
      ) => resolveProjectArtifactPath(root, artifact, config)
      put(projectPath('projectConfig'), JSON.stringify(config))
      put(projectPath('sourceNovel'), '# 临时原著\n林舟进入院子。')
      for (let chapter = 1; chapter <= 12; chapter++) {
        put(
          join(
            root,
            'custom/source/chapters',
            `chapter-${String(chapter).padStart(3, '0')}.md`
          ),
          `第${chapter}章\n临时原著第${chapter}章正文。`
        )
      }
      let initial = buildDefaultPlotBreakdownTemplate(config)
      if (template === 'legacy')
        initial = initial.replace(
          '> 暂无已发布剧情批次。首次拆解从第1批（第1-6章）开始，审核通过后追加到这里。',
          '### 第1批（第1-6章）\n\n[后续批次剧情将追加到这里]'
        )
      put(projectPath('plotBreakdown'), initial)
      const summary = () =>
        summarizeProjectPlotBreakdown({ projectPath: root, config })
      expect(summary()).toMatchObject({
        totalBatches: 0,
        totalEntries: 0,
        nextBatchNumber: 1,
        chapterEnd: null,
        nextChapterStart: 1,
        nextChapterEnd: 6
      })
      expect(readFileSync(projectPath('plotBreakdown'), 'utf8')).toBe(initial)
      expect(new ProductionCommitStore(root, config).list()).toEqual([])
      const params = {
        projectId: 'bootstrap',
        projectPath: root,
        episodeNum: 1,
        projectName: config.projectName,
        visualStyle: config.visualStyle,
        targetMedium: config.targetMedium,
        operationId: 'bootstrap-first-production'
      }
      const runner = () =>
        new WorkflowStepRunner(join(process.cwd(), 'resources/builtin-skills'))
      runtime.generate.mockResolvedValueOnce(
        '【剧情1】院子，林舟逼问守卫，第1集，状态：未用'
      )
      expect(
        await runWorkflowAction(runner(), 'runStoryGeneration', params)
      ).toMatchObject({ success: true })
      expect(runtime.generate.mock.calls[0][0].user).toContain('章节范围：1-6')
      expect(
        readFileSync(
          resolveEpisodeArtifactPath(root, 'storyBeat', 1, config),
          'utf8'
        )
      ).toContain('feicai-story-batch:1')
      expect(readFileSync(projectPath('plotBreakdown'), 'utf8')).toBe(initial)
      runtime.generate.mockResolvedValueOnce(pass).mockResolvedValueOnce(pass)
      let interrupted = false
      const original = ProductionCommitStore.prototype.install
      const inject = vi
        .spyOn(ProductionCommitStore.prototype, 'install')
        .mockImplementation(function (this: ProductionCommitStore, record) {
          if (record.key === 'review:story_review:1') {
            inject.mockRestore()
            return original.call(
              new ProductionCommitStore(root, config, (point) => {
                if (point === 'installed:0') {
                  interrupted = true
                  expect(
                    new ProductionCommitStore(root, config).get(
                      params.operationId,
                      'review:story_review:1'
                    )?.phase
                  ).toBe('prepared')
                  throw new Error('first publication interrupted')
                }
              }),
              record
            )
          }
          return original.call(this, record)
        })
      try {
        expect(
          await runWorkflowAction(runner(), 'runStoryReview', params)
        ).toMatchObject({ success: false })
      } finally {
        inject.mockRestore()
      }
      expect(interrupted).toBe(true)
      // The service repairs the failed runner's prepared write set before it
      // releases its lease; a fresh runner then reuses the completed receipt.
      expect(
        new ProductionCommitStore(root, config).get(
          params.operationId,
          'review:story_review:1'
        )
      ).toMatchObject({ phase: 'committed', projected: true })
      for (let replay = 0; replay < 2; replay++) {
        expect(
          await runWorkflowAction(runner(), 'runStoryReview', params)
        ).toMatchObject({ success: true })
      }
      expect(runtime.generate).toHaveBeenCalledTimes(3)
      expect(summary()).toMatchObject({
        totalBatches: 1,
        totalEntries: 1,
        nextBatchNumber: 2,
        chapterStart: 1,
        chapterEnd: 6,
        nextChapterStart: 7,
        nextChapterEnd: 12
      })
      const published = readPlotBreakdown({ projectPath: root, config })
        .document.batches[0].entries[0]
      runtime.generate
        .mockResolvedValueOnce(script)
        .mockResolvedValueOnce(pass)
        .mockResolvedValueOnce(pass)
      expect(
        await runWorkflowAction(runner(), 'runScriptGeneration', params)
      ).toMatchObject({ success: true })
      for (let replay = 0; replay < 2; replay++) {
        expect(
          await runWorkflowAction(runner(), 'runScriptReview', params)
        ).toMatchObject({ success: true })
      }
      expect(runtime.generate).toHaveBeenCalledTimes(6)
      expect(
        readPlotBreakdown({ projectPath: root, config }).document.batches[0]
          .entries[0]
      ).toMatchObject({
        id: published.id,
        index: published.index,
        status: '已用'
      })
      expect(summary()).toMatchObject({
        totalBatches: 1,
        totalEntries: 1,
        usedEntries: 1,
        unusedEntries: 0,
        nextBatchNumber: 2,
        chapterEnd: 6
      })
      expect(
        new ProductionCommitStore(root, config)
          .list()
          .every((record) => record.phase === 'committed' && record.projected)
      ).toBe(true)
      expect(getExecutionLease()).toBeNull()
    }
  )

  it.each(['novel', 'story', 'script'] as const)(
    '%s completes under the shared lease, exports, and rejects changed visual inputs',
    async (entryStage) => {
      const config: ProjectConfig = {
        projectName: '集成验收',
        entryStage,
        totalEpisodes: 1,
        chaptersPerEpisode: 1,
        visualStyle: '写实',
        targetMedium: '短剧',
        createdAt: '2026-01-01',
        pipelineSettings: { scriptWordCountMin: 1, scriptWordCountMax: 5000 },
        directories: {
          outputsDir: 'custom/outputs',
          assetsDir: 'custom/assets',
          reviewsDir: 'custom/reviews'
        }
      }
      const db = initDatabase()
      insertProjectRecord(db, {
        id: 'integration',
        name: config.projectName,
        projectPath: root,
        visualStyle: config.visualStyle,
        targetMedium: config.targetMedium,
        totalEpisodes: 1,
        configJson: JSON.stringify(config),
        createdAt: config.createdAt,
        updatedAt: config.createdAt
      })
      const projectPath = (
        artifact: Parameters<typeof resolveProjectArtifactPath>[1]
      ) => resolveProjectArtifactPath(root, artifact, config)
      const episodePath = (
        artifact: Parameters<typeof resolveEpisodeArtifactPath>[1]
      ) => resolveEpisodeArtifactPath(root, artifact, 1, config)
      put(projectPath('projectConfig'), JSON.stringify(config))
      const params = {
        projectId: 'integration',
        projectPath: root,
        episodeNum: 1,
        projectName: config.projectName,
        visualStyle: config.visualStyle,
        targetMedium: config.targetMedium
      }
      const runner = new WorkflowStepRunner(
        join(process.cwd(), 'resources/builtin-skills')
      )
      const action = async (
        name: Parameters<typeof runWorkflowAction>[1],
        ...responses: string[]
      ) => {
        for (const response of responses)
          runtime.generate.mockImplementationOnce(async () => {
            expect(getExecutionLease()?.owner).toBe('workflow')
            return response
          })
        expect(await runWorkflowAction(runner, name, params)).toMatchObject({
          success: true
        })
        expect(getExecutionLease()).toBeNull()
      }
      if (entryStage === 'novel') {
        put(projectPath('sourceNovel'), '# 原著\n林舟进入院子，守卫拔刀。')
        await action(
          'runStoryGeneration',
          '【剧情1】院落，林舟逼问守卫，反击，第1集，状态：未用'
        )
        await action('runStoryReview', pass, pass)
      } else if (entryStage === 'story') {
        put(
          episodePath('storyBeat'),
          '林舟进入院子，守卫拔刀，门外传来追兵声。'
        )
        await action('runStoryReview', pass, pass)
      }
      if (entryStage === 'script') put(episodePath('script'), script)
      else await action('runScriptGeneration', script)
      await action('runScriptReview', pass, pass)

      // A suspended real provider call proves mutation IPC conflicts while normal
      // pipeline writes, publication and state persistence proceed on the same lease.
      const entered = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const outputs = ['# 导演分析\n开场冲突，节奏递进。', art, storyboard]
      runtime.stream.mockImplementation(async function* () {
        expect(getExecutionLease()?.owner).toBe('pipeline')
        const output = outputs.shift()
        if (outputs.length === 2) {
          entered.resolve()
          await resume.promise
        }
        if (!output) throw new Error('Unexpected generation')
        yield output
      })
      runtime.generate.mockImplementation(async () => {
        expect(getExecutionLease()?.owner).toBe('pipeline')
        return pass
      })
      const pipeline = new PipelineStateMachine(
        join(process.cwd(), 'resources/builtin-skills')
      )
      pipeline.on('error', () => {})
      const running = launchPipeline(
        pipeline,
        { ...params, startStage: 'director', singleStage: true },
        { waitForCompletion: true, operationId: 'integration-pipeline' }
      )
      await Promise.race([
        entered.promise,
        running.then((result) => {
          throw new Error(
            `Pipeline ended before generation: ${JSON.stringify(result)}`
          )
        })
      ])
      await expect(
        invoke(IPC.ASSET_UPDATE_PROMPT, {
          projectPath: root,
          assetType: 'character',
          assetName: '林舟',
          newPromptText: '冲突写入'
        })
      ).rejects.toThrow('请等待')
      resume.resolve()
      expect(await running).toMatchObject({
        success: true,
        state: 'director_done'
      })
      expect(getExecutionLease()).toBeNull()
      await action('runCharacterDesign', '# 林舟\n左眉有疤，灰色外套。')
      expect(
        await launchPipeline(
          pipeline,
          { ...params, startStage: 'art' },
          { waitForCompletion: true, operationId: 'integration-pipeline' }
        )
      ).toMatchObject({ success: true, state: 'episode_complete' })
      expect(getExecutionLease()).toBeNull()
      expect(outputs).toEqual([])
      const pipelineCommits = new ProductionCommitStore(root, config)
        .list()
        .filter((record) =>
          record.operationId.startsWith('integration-pipeline:review:')
        )
      expect(pipelineCommits.map((record) => record.key).sort()).toEqual([
        'review:art:1',
        'review:director:1',
        'review:storyboard_review:1'
      ])
      expect(
        pipelineCommits.every(
          (record) => record.projected && record.phase === 'committed'
        )
      ).toBe(true)
      const state: ProjectPipelineState = JSON.parse(
        readFileSync(projectPath('pipelineState'), 'utf8')
      )
      for (const stage of ['director', 'art', 'storyboard'] as const) {
        const review = state.episodes[1].stageStates[stage]?.lastReview
        expect(review).toBeDefined()
        expect(isReviewCurrent(review!, root, 1, config)).toBe(true)
      }
      expect(readFileSync(projectPath('characterPrompts'), 'utf8')).toContain(
        '灰色外套'
      )
      expect(await invoke('asset:prompt-stats', root, 1)).toEqual({
        totalCount: 2,
        totalDuration: 16.5,
        avgDuration: 8.3
      })
      expect(await invoke('asset:load-prompts', root, 1)).toMatchObject([
        {
          references: [
            { assetType: 'character', assetName: '林舟' },
            { assetType: 'scene', assetName: '院子' }
          ]
        },
        {
          references: [
            { assetType: 'character', assetName: '林舟' },
            { assetType: 'scene', assetName: '院子' }
          ]
        }
      ])
      const target = join(runtime.directory, 'approved.md')
      runtime.saveDialog.mockResolvedValue({
        canceled: false,
        filePath: target
      })
      const exportParams = {
        projectPath: root,
        projectName: config.projectName,
        episodeRange: [1],
        format: 'markdown'
      }
      const lease = acquireExecutionLease('data:backup-project')
      expect(await invoke(IPC.EXPORT_PROMPTS, exportParams)).toMatchObject({
        error: expect.stringContaining('请等待')
      })
      expect(existsSync(target)).toBe(false)
      releaseExecutionLease(lease)
      expect(await invoke(IPC.EXPORT_PROMPTS, exportParams)).toMatchObject({
        success: true,
        count: 1
      })
      expect(readFileSync(target, 'utf8')).toContain('6-10秒：定格')
      expect(getExecutionLease()).toBeNull()

      // Real asset mutation crosses its own IPC lease and invalidates generated reviews.
      const published = readFileSync(projectPath('characterPrompts'), 'utf8')
      expect(
        await invoke(IPC.ASSET_UPDATE_PROMPT, {
          projectPath: root,
          assetType: 'character',
          assetName: '林舟',
          newPromptText: '红色外套。'
        })
      ).toEqual({ success: true })
      runtime.saveDialog.mockClear()
      expect(await invoke(IPC.EXPORT_PROMPTS, exportParams)).toHaveProperty(
        'error'
      )
      expect(runtime.saveDialog).not.toHaveBeenCalled()
      put(projectPath('characterPrompts'), published)
      expect(await invoke(IPC.EXPORT_PROMPTS, exportParams)).toMatchObject({
        success: true
      })
      put(episodePath('characterDesign'), '# 林舟\n无疤，红衣。')
      runtime.saveDialog.mockClear()
      expect(await invoke(IPC.EXPORT_PROMPTS, exportParams)).toHaveProperty(
        'error'
      )
      expect(runtime.saveDialog).not.toHaveBeenCalled()
      expect(getExecutionLease()).toBeNull()
      if (entryStage !== 'novel') {
        expect(existsSync(projectPath('sourceNovel'))).toBe(false)
        expect(existsSync(projectPath('plotBreakdown'))).toBe(false)
      }
    }
  )
})
