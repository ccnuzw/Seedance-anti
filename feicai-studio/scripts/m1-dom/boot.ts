/* eslint-disable @typescript-eslint/no-explicit-any */
// Synthetic read API only. Unknown methods fail; no production IPC is exposed.
const calls: any[] = []
const fixtures: any = {}
const deferred: any[] = []
const state = { fixtures, calls, deferred }
;(window as any).fixtureState = state
function record(method: string, args: any[]) {
  calls.push({ method, args })
}
async function read(method: string, id: string, args: any[], value: any) {
  record(method, args)
  const fixture = fixtures[id]
  if (fixture?.defer)
    await new Promise((resolve) => deferred.push({ id, method, resolve }))
  if (fixture?.error && (fixture.error === 'all' || fixture.error === method))
    throw new Error('synthetic read failure')
  return structuredClone(value)
}
const idFromPath = (p: string) => p.split('/')[2]
const api = {
  async syncProjectStatus(id: string, p: string) {
    return read('syncProjectStatus', id, [id, p], fixtures[id]?.episodes || [])
  },
  async getProject(id: string) {
    record('getProject', [id])
    return structuredClone(fixtures[id]?.project || null)
  },
  async getPipelineState() {
    record('getPipelineState', [])
    return { state: 'idle', context: null, logs: [] }
  },
  async listProjectEpisodes(id: string) {
    record('listProjectEpisodes', [id])
    return structuredClone(fixtures[id]?.episodes || [])
  },
  async getProjectPipelineState(p: string) {
    const id = idFromPath(p)
    return read(
      'getProjectPipelineState',
      id,
      [p],
      fixtures[id]?.pipeline || { projectId: id, episodes: {} }
    )
  },
  async getPlotBreakdownSummary(id: string) {
    return read(
      'getPlotBreakdownSummary',
      id,
      [id],
      fixtures[id]?.waterline || {
        totalEntries: 10,
        unusedEntries: 8,
        usedEntries: 2,
        totalBatches: 1,
        readyEpisodeCount: 2,
        readyEpisodeNumbers: [1, 2],
        usedEpisodeCount: 0,
        usedEpisodeNumbers: fixtures[id]?.usedEpisodeNumbers || [],
        chapterStart: 1,
        chapterEnd: 2,
        nextBatchNumber: 2,
        targetChapterLimit: 10,
        totalSourceChapters: fixtures[id]?.chapterSource
          ? 10
          : fixtures[id]?.source === false
            ? 0
            : 10,
        unprocessedChapterCount: 8,
        overflowChapterCount: 0,
        waterlineStatus: 'ready',
        nextActionLabel: '生成剧本',
        nextActionMode: 'script',
        breakdownProgressPct: 20,
        scriptProgressPct: 0,
        remainingBatchCount: 4,
        nextChapterStart: 3,
        nextChapterEnd: 4,
        path: `/synthetic/${id}/story/plot-breakdown.md`,
        exists: true
      }
    )
  },
  async readTextFile(p: string) {
    const id = idFromPath(p)
    return read(
      'readTextFile',
      id,
      [p],
      p.endsWith('/novel.md')
        ? fixtures[id]?.source === false
          ? null
          : '合成原文'
        : null
    )
  },
  async listSourceChapters(id: string) {
    record('listSourceChapters', [id])
    return []
  },
  async inspectProjectDirectory(p: string) {
    record('inspectProjectDirectory', [p])
    return { integrity: { checks: [] } }
  },
  async listCharacters(p: string) {
    record('listCharacters', [p])
    return []
  },
  async listScenes(p: string) {
    record('listScenes', [p])
    return []
  },
  onPipelineTaskChanged: () => () => {},
  onPipelineStateChanged: () => () => {},
  onPipelineLog: () => () => {},
  onPipelineStream: () => () => {},
  onPipelineReviewResult: () => () => {},
  onPipelineError: () => () => {}
}
;(window as any).feicaiAPI = new Proxy(api, {
  get(target, name) {
    if (name in target) return target[name as keyof typeof target]
    return (...args: any[]) => {
      record(`FORBIDDEN:${String(name)}`, args)
      throw new Error(`No production API permitted: ${String(name)}`)
    }
  }
})
import('./suite.tsx').catch((error) =>
  (window as any).testFinish({
    ok: false,
    error: String(error),
    stack: error.stack,
    calls
  })
)
