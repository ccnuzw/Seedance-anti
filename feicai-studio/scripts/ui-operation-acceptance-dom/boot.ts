/* eslint-disable @typescript-eslint/no-explicit-any */
// All data and execution live in renderer memory; unknown API calls fail closed.
const projects = Object.fromEntries(
  ['a', 'b'].map((id) => [
    id,
    {
      id,
      name: `验收项目 ${id.toUpperCase()}`,
      projectPath: `/synthetic/${id}`,
      totalEpisodes: 2,
      visualStyle: '水墨',
      targetMedium: '短剧',
      config: { entryStage: 'novel', totalEpisodes: 2 },
      updatedAt: ''
    }
  ])
)
const f: any = {
  projects,
  files: {},
  calls: [],
  tasks: [],
  queue: null,
  execution: { busy: false, phase: 'idle' },
  listeners: {},
  batch: 7,
  ready: [],
  used: [],
  remaining: 8,
  reviewStatus: 'pending',
  unknownEpisodes: false,
  failStatus: false,
  failSummary: false,
  runCount: 0
}
;(window as any).fixture = f
const record = (method: string, args: any[]) => f.calls.push({ method, args })
const emit = (name: string) => {
  for (const callback of f.listeners[name] || [])
    callback(structuredClone(name === 'task' ? f.tasks[0] : f.queue))
}
const subscribe = (name: string) => (callback: () => void) => {
  const callbacks = (f.listeners[name] ||= new Set())
  callbacks.add(callback)
  return () => callbacks.delete(callback)
}
const episodes = (id: string) =>
  f.unknownEpisodes
    ? []
    : [1, 2].map((episodeNumber) => ({
        id: `${id}-${episodeNumber}`,
        projectId: id,
        episodeNumber,
        hasScript: false,
        status: 'idle',
        updatedAt: ''
      }))
const api: any = {
  getProject: async (id: string) => structuredClone(projects[id]),
  listProjectEpisodes: async (id: string) => episodes(id),
  syncProjectStatus: async (id: string) => episodes(id),
  syncSingleEpisodeStatus: async (args: any) =>
    episodes(args.projectId).find(
      (ep: any) => ep.episodeNumber === args.episodeNum
    ),
  readTextFile: async (path: string) => {
    if (path.endsWith('project-config.json')) {
      const project = projects[path.split('/')[2]]
      return JSON.stringify({ ...project.config, projectName: project.name })
    }
    return f.files[path] ?? (path.endsWith('novel.md') ? '合成小说原文' : null)
  },
  writeTextFile: async (path: string, content: string) => {
    record('writeTextFile', [path, content])
    f.files[path] = content
    return { success: true }
  },
  saveProjectSettings: async (id: string, data: any) => {
    record('saveProjectSettings', [id, data])
    projects[id] = { ...projects[id], ...structuredClone(data) }
    f.failSummary = true
    return structuredClone(projects[id])
  },
  getPlotBreakdownSummary: async () => {
    if (f.failSummary) throw new Error('合成摘要刷新失败')
    return {
      nextBatchNumber: f.batch,
      readyEpisodeNumbers: f.ready,
      usedEpisodeNumbers: f.used,
      unprocessedChapterCount: f.remaining,
      totalSourceChapters: 10,
      nextActionMode: 'breakdown',
      nextActionLabel: '准备剧情草稿'
    }
  },
  getProjectPipelineState: async (path: string) => ({
    projectId: path.split('/')[2],
    episodes: {
      1: {
        stageStates: { story_review: { status: f.reviewStatus } },
        reviews: []
      }
    }
  }),
  listLLMConfigs: async () => [{ id: 'synthetic', category: 'llm' }],
  listPipelineTasks: async () => {
    if (f.failStatus) throw new Error('合成状态查询失败')
    return structuredClone(f.tasks)
  },
  getExecutionStatus: async () => {
    if (f.failStatus) throw new Error('合成状态查询失败')
    return structuredClone(f.execution)
  },
  getPipelineState: async () => ({ state: 'idle', context: null, logs: [] }),
  getBatchState: async () => {
    if (f.failQueue) throw new Error('合成队列查询失败')
    return structuredClone(f.queue)
  },
  resumeBatch: async (queueId: string) => {
    record('resumeBatch', [queueId])
    if (
      queueId !== f.queue?.id ||
      !['paused', 'interrupted'].includes(f.queue.status)
    )
      throw new Error('队列身份或恢复状态不匹配')
    await new Promise<void>((resolve) => {
      f.finishResume = resolve
    })
    f.queue.status = 'running'
    f.queue.updatedAt++
    f.execution = { busy: true, phase: 'running', owner: 'batch' }
    emit('batch')
    return structuredClone(f.queue)
  },
  runStoryGeneration: async (args: any) => {
    record('runStoryGeneration', [args])
    const runId = `generation-${++f.runCount}`
    f.tasks = [
      {
        identity: {
          projectId: args.projectPath.split('/')[2],
          taskId: runId,
          runId,
          episodeNum: args.episodeNum,
          stage: 'story'
        },
        kind: 'workflow',
        status: 'running',
        settings: {}
      }
    ]
    f.execution = { busy: true, phase: 'running', owner: 'workflow' }
    emit('task')
    await new Promise<void>((resolve) => {
      f.finishGeneration = () => {
        f.files[`${args.projectPath}/story/episode-beats/ep01.md`] =
          `<!-- feicai-story-batch:${args.batchNumber} -->\n【剧情1】合成草稿`
        f.reviewStatus = 'pending'
        f.tasks[0].status = 'completed'
        f.execution = { busy: false, phase: 'idle' }
        emit('task')
        resolve()
      }
    })
    return { success: true }
  },
  startBatch: async (args: any) => {
    record('startBatch', [args])
    f.queue = {
      ...args,
      id: 'acceptance-queue',
      status: 'running',
      cursor: 0,
      tasks: args.episodes.map((episodeNum: number) => ({
        episodeNum,
        status: 'pending',
        steps: {}
      })),
      updatedAt: 1
    }
    f.execution = { busy: true, phase: 'running', owner: 'batch' }
    emit('batch')
    return structuredClone(f.queue)
  },
  onPipelineTaskChanged: subscribe('task'),
  onPipelineStateChanged: subscribe('state'),
  onBatchState: subscribe('batch'),
  onPipelineLog: subscribe('log'),
  onPipelineStream: subscribe('stream'),
  onPipelineReviewResult: subscribe('review'),
  onPipelineError: subscribe('error'),
  inspectProjectDirectory: async () => ({ integrity: { checks: [] } }),
  listSourceChapters: async () => [],
  getSourceNovelSummary: async () => ({ exists: true }),
  selectFile: async () => null
}
;(window as any).feicaiAPI = new Proxy(api, {
  get(target, name) {
    if (name in target) return target[name]
    return (...args: any[]) => {
      record(`FORBIDDEN:${String(name)}`, args)
      throw new Error(`Unexpected synthetic API: ${String(name)}`)
    }
  }
})
window.confirm = () => true
void import('./suite')
