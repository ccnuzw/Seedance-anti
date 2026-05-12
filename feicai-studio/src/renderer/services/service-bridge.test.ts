import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = {
  startPipeline: vi.fn(),
  runPipelineAndWait: vi.fn(),
  pausePipeline: vi.fn(),
  abortPipeline: vi.fn(),
  retryPipeline: vi.fn(),
  skipPipeline: vi.fn(),
  getPipelineState: vi.fn(),
  onPipelineStateChanged: vi.fn(),
  onPipelineLog: vi.fn(),
  onPipelineStream: vi.fn(),
  onPipelineReviewResult: vi.fn(),
  onPipelineError: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  detectProjectDirectory: vi.fn(),
  inspectProjectDirectory: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  listProjectEpisodes: vi.fn(),
  syncProjectStatus: vi.fn(),
  syncSingleEpisodeStatus: vi.fn(),
  getProjectPipelineState: vi.fn(),
  migrateLegacyNovelDirectory: vi.fn(),
  repairProjectIssues: vi.fn(),
  runStoryGeneration: vi.fn(),
  runStoryReview: vi.fn(),
  runScriptGeneration: vi.fn(),
  runScriptReview: vi.fn(),
  runCharacterDesign: vi.fn(),
  runStoryboardReview: vi.fn()
}

describe('service-bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { feicaiAPI: api })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('workflow-actions 会原样透传参数到 feicaiAPI', async () => {
    const { runStoryReview, runScriptReview, runStoryboardReview } =
      await import('./workflow-actions')
    api.runStoryReview.mockResolvedValue({ success: true })
    api.runScriptReview.mockResolvedValue({ success: true })
    api.runStoryboardReview.mockResolvedValue({ success: true })

    const params = {
      projectPath: '/tmp/project',
      episodeNum: 3,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧'
    }

    await runStoryReview(params)
    await runScriptReview(params)
    await runStoryboardReview(params)

    expect(api.runStoryReview).toHaveBeenCalledWith(params)
    expect(api.runScriptReview).toHaveBeenCalledWith(params)
    expect(api.runStoryboardReview).toHaveBeenCalledWith(params)
  })

  it('pipeline-service 会原样透传启动参数和控制命令', async () => {
    const {
      startPipeline,
      runPipelineAndWait,
      pausePipeline,
      abortPipeline,
      retryPipeline,
      skipPipeline,
      getPipelineState
    } = await import('./pipeline-service')

    const params = {
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 2,
      projectName: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      startStage: 'art' as const,
      singleStage: true
    }

    api.startPipeline.mockResolvedValue({ success: true, state: 'art_done' })
    api.runPipelineAndWait.mockResolvedValue({
      success: true,
      state: 'art_done'
    })
    api.getPipelineState.mockResolvedValue({ state: 'idle' })

    await startPipeline(params)
    await runPipelineAndWait(params)
    await pausePipeline()
    await abortPipeline()
    await retryPipeline('art')
    await skipPipeline()
    await getPipelineState()

    expect(api.startPipeline).toHaveBeenCalledWith(params)
    expect(api.runPipelineAndWait).toHaveBeenCalledWith(params)
    expect(api.pausePipeline).toHaveBeenCalled()
    expect(api.abortPipeline).toHaveBeenCalled()
    expect(api.retryPipeline).toHaveBeenCalledWith('art')
    expect(api.skipPipeline).toHaveBeenCalled()
    expect(api.getPipelineState).toHaveBeenCalled()
  })

  it('project-service 会原样透传项目与状态查询参数', async () => {
    const {
      listProjects,
      getProject,
      detectProjectDirectory,
      inspectProjectDirectory,
      createProject,
      deleteProject,
      listProjectEpisodes,
      syncProjectStatus,
      syncSingleEpisodeStatus,
      getProjectPipelineState,
      migrateLegacyNovelDirectory,
      repairProjectIssues
    } = await import('./project-service')

    await listProjects()
    await getProject('project-1')
    await detectProjectDirectory('/tmp/project')
    await inspectProjectDirectory('/tmp/project')
    await createProject({
      name: '项目',
      visualStyle: '现实',
      targetMedium: '短剧',
      projectPath: '/tmp/project',
      totalEpisodes: 12,
      config: { projectName: '项目' }
    })
    await deleteProject('project-1')
    await listProjectEpisodes('project-1')
    await syncProjectStatus('project-1', '/tmp/project')
    await syncSingleEpisodeStatus({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 4
    })
    await getProjectPipelineState('/tmp/project')
    await migrateLegacyNovelDirectory('/tmp/project')
    await repairProjectIssues({
      projectPath: '/tmp/project',
      actionIds: ['apply_suggested_config'],
      trustMode: 'registered'
    })

    expect(api.listProjects).toHaveBeenCalled()
    expect(api.getProject).toHaveBeenCalledWith('project-1')
    expect(api.detectProjectDirectory).toHaveBeenCalledWith('/tmp/project')
    expect(api.inspectProjectDirectory).toHaveBeenCalledWith('/tmp/project')
    expect(api.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/tmp/project' })
    )
    expect(api.deleteProject).toHaveBeenCalledWith('project-1')
    expect(api.listProjectEpisodes).toHaveBeenCalledWith('project-1')
    expect(api.syncProjectStatus).toHaveBeenCalledWith(
      'project-1',
      '/tmp/project'
    )
    expect(api.syncSingleEpisodeStatus).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectPath: '/tmp/project',
      episodeNum: 4
    })
    expect(api.getProjectPipelineState).toHaveBeenCalledWith('/tmp/project')
    expect(api.migrateLegacyNovelDirectory).toHaveBeenCalledWith('/tmp/project')
    expect(api.repairProjectIssues).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      actionIds: ['apply_suggested_config'],
      trustMode: 'registered'
    })
  })
})
