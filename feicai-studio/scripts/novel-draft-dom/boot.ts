/* eslint-disable @typescript-eslint/no-explicit-any */
const state: any = {
  files: {},
  calls: [],
  batch: 7,
  ready: [],
  used: [],
  remaining: 12,
  source: true,
  episodes: [{ projectId: 'a', episodeNumber: 12, hasScript: false }],
  model: true,
  status: 'pending',
  fail: false,
  defer: null
}
;(window as any).fixture = state
const ep = { id: 'a-4', projectId: 'a', episodeNumber: 4, hasStoryBeat: false }
const record = (method: string, args: any[]) =>
  state.calls.push({ method, args })
;(window as any).feicaiAPI = {
  readTextFile: async (p: string) => {
    record('read', [p])
    if (state.readFail) throw new Error('合成读取失败')
    return state.files[p] ?? null
  },
  writeTextFile: async (p: string, text: string) => {
    record('write', [p, text])
    state.files[p] = text
    return { success: true }
  },
  listLLMConfigs: async () =>
    state.model ? [{ id: 'mock', category: 'llm' }] : [],
  getPlotBreakdownSummary: async () => ({
    nextBatchNumber: state.batch,
    readyEpisodeNumbers: state.ready,
    usedEpisodeNumbers: state.used,
    unprocessedChapterCount: state.remaining
  }),
  getProjectPipelineState: async () => ({
    episodes: {
      4: {
        stageStates: { story_review: { status: state.status } },
        reviews: []
      }
    }
  }),
  listProjectEpisodes: async () => {
    if (state.episodeFail) throw new Error('合成集数读取失败')
    return state.episodeOverride ?? [ep, ...state.episodes]
  },
  syncSingleEpisodeStatus: async () => ep,
  runStoryGeneration: async (args: any) => {
    record('generate', [args])
    if (state.defer) await state.defer
    if (state.fail) return { success: false, error: '合成零剧情点错误' }
    state.files[state.storyPath] =
      `<!-- feicai-story-batch:${args.batchNumber} -->\n【剧情1】测试`
    state.status = 'pending'
    return { success: true }
  },
  runStoryReview: async (args: any) => {
    record('review', [args])
    state.status = state.fail ? 'failed' : 'passed'
    if (!state.fail) state.ready = [12]
    return {
      success: !state.fail,
      review: {
        stage: 'story_review',
        passed: !state.fail,
        result: state.fail ? 'FAIL' : 'PASS',
        score: 8,
        feedback: '合成反馈',
        issues: [],
        createdAt: new Date().toISOString()
      }
    }
  },
  selectFile: async () => null,
  inspectProjectDirectory: async () => ({
    integrity: {
      checks: [{ id: 'source_novel', status: state.source ? 'pass' : 'fail' }]
    }
  }),
  repairProjectIssues: async () => ({ readyItems: [] }),
  listSourceChapters: async () => [],
  getSourceNovelSummary: async () => ({ exists: false })
}
void import('./suite')
