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
    stream: vi.fn()
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
    }
  }
})
// The bundled worker URL is not executed by this service/IPC regression.
vi.mock('../workers/project-sync-worker?modulePath', () => ({ default: '' }))
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
        { waitForCompletion: true }
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
          { waitForCompletion: true }
        )
      ).toMatchObject({ success: true, state: 'episode_complete' })
      expect(getExecutionLease()).toBeNull()
      expect(outputs).toEqual([])
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
