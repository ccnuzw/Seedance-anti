import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  readdirSync
} from 'fs'
import { dirname, join, relative } from 'path'
import { tmpdir } from 'os'
import type {
  Episode,
  Project,
  ProjectPipelineState,
  ReviewResult,
  ReviewStage
} from '@shared/types'
import type { EpisodeArtifactId } from '@shared/artifact-registry'
import {
  resolveEpisodeArtifactPath,
  resolveProjectArtifactPath
} from '@shared/path-resolver'
import { formatReviewMarkdown } from '@shared/review-artifacts'
import { IPC } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => {
  const frame = { url: 'file:///app/index.html' }
  const sender = {
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false
  }
  return {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    frame,
    sender,
    projects: [] as Project[],
    episodes: [] as Episode[],
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn()
  }
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, callback)
  },
  BrowserWindow: {
    fromWebContents: (sender: unknown) =>
      sender === mocks.sender ? { id: 1 } : null
  },
  dialog: {
    showSaveDialog: mocks.showSaveDialog,
    showOpenDialog: mocks.showOpenDialog
  }
}))
vi.mock('../services/project-service', () => ({
  listRegisteredProjects: () => mocks.projects,
  listProjectEpisodes: () => mocks.episodes
}))
import {
  registerExportHandlers,
  escapeCsvField,
  safeExportName
} from './export-handlers'
import { captureReviewProvenance } from '../engine/artifact-provenance'
import {
  registerProjectRoot,
  resetAccessControl
} from '../security/access-control'
import { flushPendingWrites } from '../io/atomic-file'

const directories: string[] = []
function temporary(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'feicai-export-'))
  )
  directories.push(root)
  return root
}
function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
function addProject(): Project {
  const project: Project = {
    id: 'project',
    name: '测试项目',
    visualStyle: '写实',
    targetMedium: '短剧',
    totalEpisodes: 3,
    projectPath: temporary(),
    config: {
      projectName: '测试项目',
      visualStyle: '写实',
      targetMedium: '短剧',
      totalEpisodes: 3,
      chaptersPerEpisode: 0,
      createdAt: '2026-01-01',
      directories: {
        scriptDir: 'custom/scripts',
        outputsDir: 'custom/outputs',
        assetsDir: 'custom/assets',
        reviewsDir: 'custom/reviews'
      }
    },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01'
  }
  mocks.projects.push(project)
  registerProjectRoot(project.projectPath)
  return project
}
const state: ProjectPipelineState = {
  projectId: 'project',
  episodes: {},
  updatedAt: '2026-01-01'
}
function approveEpisode(
  project: Project,
  episode: number,
  content = '## 镜头一\n正文'
): void {
  const artifacts: Array<[EpisodeArtifactId, string]> = [
    ['script', `剧本${episode}`],
    ['directorAnalysis', `导演${episode}`],
    ['artDesign', `服化道${episode}`],
    ['seedancePrompts', content]
  ]
  for (const [artifact, body] of artifacts)
    write(
      resolveEpisodeArtifactPath(
        project.projectPath,
        artifact,
        episode,
        project.config
      ),
      body
    )
  const stages: ReviewStage[] = [
    'script_review',
    'director',
    'art',
    'storyboard_review'
  ]
  const reviews: ReviewResult[] = []
  for (const stage of stages) {
    const review: ReviewResult = {
      stage,
      reviewType: 'business',
      result: 'PASS',
      passed: true,
      score: 9,
      feedback: '审核通过',
      issues: [],
      createdAt: '2026-11-11T00:00:00.000Z',
      ...captureReviewProvenance(
        project.projectPath,
        stage,
        episode,
        project.config
      )
    }
    reviews.push(review)
    if (stage === 'script_review' || stage === 'storyboard_review') {
      write(
        resolveEpisodeArtifactPath(
          project.projectPath,
          stage === 'script_review' ? 'scriptReview' : 'storyboardReview',
          episode,
          project.config
        ),
        formatReviewMarkdown('审核', review)
      )
    }
  }
  state.episodes[episode] = {
    episodeNum: episode,
    status: 'complete',
    lastStage: 'storyboard_review',
    completedStages: stages,
    stageStates: {},
    reviews,
    totalDurationSeconds: 0,
    updatedAt: '2026-11-11T00:00:00.000Z'
  }
  for (const review of reviews)
    state.episodes[episode].stageStates[review.stage] = {
      stage: review.stage,
      status: 'passed',
      attempts: 1,
      updatedAt: review.createdAt,
      lastReview: review
    }
  write(
    resolveProjectArtifactPath(
      project.projectPath,
      'pipelineState',
      project.config
    ),
    JSON.stringify(state)
  )
}
async function invoke(
  channel: string,
  params: unknown
): Promise<Record<string, unknown>> {
  const result = await Promise.resolve().then(() =>
    mocks.handlers.get(channel)!(
      { sender: mocks.sender, senderFrame: mocks.frame },
      params
    )
  )
  return result as Record<string, unknown>
}
function promptParams(project: Project, format = 'markdown') {
  return {
    projectPath: project.projectPath,
    projectName: project.name,
    episodeRange: [1],
    format
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  resetAccessControl()
  mocks.projects.length = 0
  mocks.episodes.length = 0
  mocks.handlers.clear()
  state.episodes = {}
  mocks.frame.url = 'file:///app/index.html'
  setTrustedIpcRendererUrl(mocks.frame.url)
  registerExportHandlers()
})
afterEach(async () => {
  await flushPendingWrites()
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})
import { setTrustedIpcRendererUrl } from '../security/safe-ipc'

describe('当前审核有效提示词导出', () => {
  it('从注册配置目录读取，实际导出计数排除缺失、失效和重复集数', async () => {
    const project = addProject()
    approveEpisode(project, 1, '## 第一集\n已审核正文')
    approveEpisode(project, 2, '## 第二集\n原正文')
    write(
      resolveEpisodeArtifactPath(
        project.projectPath,
        'seedancePrompts',
        2,
        project.config
      ),
      '## 第二集\n审核后已编辑'
    )
    const target = join(temporary(), 'prompts.md')
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: target
    })
    const result = await invoke(IPC.EXPORT_PROMPTS, {
      ...promptParams(project),
      episodeRange: [1, 1, 2, 3]
    })
    expect(result).toMatchObject({
      success: true,
      path: target,
      count: 1,
      skipped: 2,
      gate: 'current-reviewed-only'
    })
    expect(readFileSync(target, 'utf8')).toContain('已审核正文')
    expect(readFileSync(target, 'utf8')).not.toContain('审核后已编辑')
    expect(existsSync(join(project.projectPath, 'outputs'))).toBe(false)
  })

  it('CSV所有字段引号转义并将公式文本化，保留正文换行', async () => {
    const project = addProject()
    approveEpisode(
      project,
      1,
      '## =HYPERLINK("http://evil")\n+SUM(1,2)\n下一行\n## 普通"标题"\n@危险'
    )
    const target = join(temporary(), 'prompts.csv')
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: target
    })
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project, 'csv'))
    ).toMatchObject({ success: true, count: 1 })
    const csv = readFileSync(target, 'utf8')
    expect(csv).toContain('"集数","标题","内容"')
    expect(csv).toContain(
      '"1","\'=HYPERLINK(""http://evil"")","\'+SUM(1,2)\n下一行"'
    )
    expect(csv).toContain('"普通""标题""","\'@危险"')
    expect(escapeCsvField('  =SUM(1)')).toBe('"\'  =SUM(1)"')
    expect(escapeCsvField('\tcmd')).toBe('"\'\tcmd"')
  })

  it('缺审核/旧PASS/任一上游失效都不能导出，也不会打开保存框', async () => {
    const project = addProject()
    write(
      resolveEpisodeArtifactPath(
        project.projectPath,
        'seedancePrompts',
        1,
        project.config
      ),
      '无审核提示词'
    )
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error')
    approveEpisode(project, 1)
    const review = state.episodes[1].reviews.find(
      (candidate) => candidate.stage === 'director'
    )!
    delete review.artifactHash
    delete review.inputHashes
    write(
      resolveProjectArtifactPath(
        project.projectPath,
        'pipelineState',
        project.config
      ),
      JSON.stringify(state)
    )
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error')
    expect(mocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('最终源链接不能被当作缺集吞掉，保存目标链接/父链接不被跟随', async () => {
    const project = addProject()
    approveEpisode(project, 1)
    const external = temporary()
    const secret = join(external, 'secret.md')
    writeFileSync(secret, 'secret')
    const target = join(temporary(), 'linked.md')
    symlinkSync(secret, target)
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: target
    })
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error', expect.stringContaining('符号链接'))
    const parent = join(temporary(), 'parent')
    symlinkSync(external, parent)
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: join(parent, 'new.md')
    })
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error', expect.stringContaining('符号链接'))
    const promptPath = resolveEpisodeArtifactPath(
      project.projectPath,
      'seedancePrompts',
      1,
      project.config
    )
    rmSync(promptPath)
    symlinkSync(join(external, 'missing.md'), promptPath)
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error', expect.stringContaining('符号链接'))
    expect(readFileSync(secret, 'utf8')).toBe('secret')
  })

  it('保存期间审核依赖变更会中止，不导出过期采集正文', async () => {
    const project = addProject()
    approveEpisode(project, 1)
    const target = join(temporary(), 'prompts.md')
    mocks.showSaveDialog.mockImplementation(async () => {
      write(
        resolveEpisodeArtifactPath(
          project.projectPath,
          'artDesign',
          1,
          project.config
        ),
        '外部修改'
      )
      return { canceled: false, filePath: target }
    })
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error', expect.stringContaining('发生变化'))
    expect(existsSync(target)).toBe(false)
  })
})

describe('白名单全部产物导出不是备份', () => {
  it('安全命名、配置目录、真实文件计数，排除状态/草稿/备份/全局素材库', async () => {
    const project = addProject()
    project.name = '../../测试/项目'
    approveEpisode(project, 1)
    write(
      join(project.projectPath, 'custom/outputs/ep01/draft.md'),
      '未审核草稿'
    )
    write(
      join(project.projectPath, 'custom/assets/character-prompts.md'),
      '未绑定的全局库'
    )
    const exportRoot = temporary()
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [exportRoot]
    })
    const result = await invoke(IPC.EXPORT_ALL, {
      projectPath: project.projectPath,
      projectName: '../forged-name'
    })
    expect(result).toMatchObject({
      success: true,
      count: 4,
      gate: 'current-reviewed-only'
    })
    const destination = String(result.path)
    expect(relative(exportRoot, destination)).not.toMatch(/^\.\./)
    expect(
      readFileSync(
        join(destination, 'custom/outputs/ep01/02-seedance-prompts.md'),
        'utf8'
      )
    ).toContain('镜头一')
    expect(
      existsSync(join(destination, 'custom/outputs/pipeline-state.json'))
    ).toBe(false)
    expect(existsSync(join(destination, 'custom/outputs/ep01/draft.md'))).toBe(
      false
    )
    expect(
      existsSync(join(destination, 'custom/assets/character-prompts.md'))
    ).toBe(false)
    expect(
      JSON.parse(
        readFileSync(join(destination, 'export-manifest.json'), 'utf8')
      )
    ).toMatchObject({ backup: false, count: 4 })
    expect(safeExportName('../../evil/name')).not.toContain('/')
    expect(safeExportName('CON')).not.toBe('CON')
  })

  it('已有导出目录不复用，避免残留旧的不合规内容混入；目标目录链接拒绝', async () => {
    const project = addProject()
    approveEpisode(project, 1)
    const root = temporary()
    const old = join(root, `${project.name}-export`)
    mkdirSync(old)
    write(join(old, 'old-draft.md'), '旧草稿')
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [root]
    })
    const result = await invoke(IPC.EXPORT_ALL, {
      projectPath: project.projectPath,
      projectName: project.name
    })
    expect(result.success).toBe(true)
    expect(result.path).not.toBe(old)
    expect(existsSync(join(String(result.path), 'old-draft.md'))).toBe(false)
    const otherRoot = temporary()
    symlinkSync(temporary(), join(otherRoot, `${project.name}-export`))
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [otherRoot]
    })
    expect(
      await invoke(IPC.EXPORT_ALL, {
        projectPath: project.projectPath,
        projectName: project.name
      })
    ).toHaveProperty('error', expect.stringContaining('符号链接'))
  })

  it('不吞掉写入I/O失败；非法参数和非应用sender拒绝', async () => {
    const project = addProject()
    approveEpisode(project, 1)
    const directoryInsteadOfFile = temporary()
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: directoryInsteadOfFile
    })
    expect(
      await invoke(IPC.EXPORT_PROMPTS, promptParams(project))
    ).toHaveProperty('error')
    expect(
      await invoke(IPC.EXPORT_PROMPTS, {
        ...promptParams(project),
        episodeRange: ['1']
      })
    ).toHaveProperty('error', expect.stringContaining('集数'))
    expect(
      await invoke(IPC.EXPORT_PROMPTS, {
        ...promptParams(project),
        format: '../../json'
      })
    ).toHaveProperty('error')
    mocks.frame.url = 'https://evil.example'
    await expect(
      invoke(IPC.EXPORT_ALL, {
        projectPath: project.projectPath,
        projectName: project.name
      })
    ).rejects.toThrow('frame')
    expect(readdirSync(directoryInsteadOfFile)).toEqual([])
  })
})
