/* eslint-disable @typescript-eslint/no-explicit-any */
// Actual renderer components and route consumers with synthetic read-only feicaiAPI.
import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate
} from 'react-router-dom'
import ProjectPage from '@renderer/pages/ProjectPage'
import ProjectRouteSync from '@renderer/components/layout/ProjectRouteSync'
import PipelinePage from '@renderer/pages/PipelinePage'
import PromptPage from '@renderer/pages/PromptPage'
import ScriptEditorPage from '@renderer/pages/ScriptEditorPage'
import StoryBeatEditorPage from '@renderer/pages/StoryBeatEditorPage'
import SourceNovelPage from '@renderer/pages/SourceEditorPage'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import '@renderer/styles/theme.css'
import '@renderer/styles/global.css'
const w = window as any
const { fixtures, calls, deferred } = w.fixtureState
const checks: string[] = []
const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message)
  checks.push(message)
}
async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 180; i++) {
    if (check()) return
    await delay()
  }
  throw new Error(
    `Timed out: ${message}; text=${document.body.innerText.slice(0, 2000)}`
  )
}
let navigate: any
function Observer() {
  navigate = useNavigate()
  const l = useLocation()
  return <output id="location">{l.pathname + l.search}</output>
}
function Shell() {
  return (
    <MemoryRouter initialEntries={['/project/none']}>
      <Observer />
      <div className="app-layout">
        <section className="app-main">
          <main className="app-content" style={{ minWidth: 0 }}>
            <Routes>
              <Route path="/project/:id" element={<ProjectRouteSync />}>
                <Route index element={<ProjectPage />} />
                <Route path="pipeline" element={<PipelinePage />} />
                <Route path="prompts" element={<PromptPage />} />
                <Route path="script" element={<ScriptEditorPage />} />
                <Route path="story" element={<StoryBeatEditorPage />} />
                <Route path="source" element={<SourceNovelPage />} />
                <Route
                  path="*"
                  element={<p>现有其他页面的路由目的地（未合成执行）</p>}
                />
              </Route>
            </Routes>
          </main>
        </section>
      </div>
    </MemoryRouter>
  )
}
function project(id: string, entryStage: string, totalEpisodes = 3) {
  return {
    id,
    name: `合成${id}`,
    projectPath: `/synthetic/${id}`,
    totalEpisodes,
    createdAt: '',
    updatedAt: '',
    config: {
      projectName: id,
      entryStage,
      totalEpisodes,
      visualStyle: '',
      targetMedium: '',
      createdAt: ''
    }
  }
}
function episode(id: string, n: number, extra = {}) {
  return {
    id: `${id}-${n}`,
    projectId: id,
    episodeNumber: n,
    status: 'idle',
    hasStoryBeat: false,
    hasStoryReview: false,
    hasScript: false,
    hasScriptReview: false,
    hasDirectorAnalysis: false,
    hasArtDesign: false,
    hasStoryboard: false,
    hasSeedancePrompts: false,
    hasStoryboardReview: false,
    ...extra
  }
}
function fixture(id: string, entry = 'script', count = 3) {
  return (fixtures[id] = {
    project: project(id, entry, count),
    episodes: Array.from({ length: count }, (_, i) => episode(id, i + 1)),
    pipeline: { projectId: id, episodes: {} }
  })
}
async function select(id: string) {
  navigate(`/project/${id}`)
  await until(
    () => useProjectStore.getState().currentProject?.id === id,
    `project ${id} loaded`
  )
  await delay()
}
async function ready() {
  await delay()
  await until(
    () =>
      document.querySelector('.production-matrix') &&
      !document
        .querySelector('.production-matrix')
        ?.getAttribute('aria-busy')
        ?.includes('true'),
    'matrix ready'
  )
}
function button(text: string, root: ParentNode = document) {
  const b = Array.from(root.querySelectorAll('button')).find((x) =>
    x.textContent?.includes(text)
  ) as HTMLButtonElement
  if (!b) throw new Error(`Missing button ${text}`)
  return b
}
function row(n: number) {
  const tr = Array.from(
    document.querySelectorAll('.production-table tbody tr')
  ).find((el) => el.querySelector('th')?.textContent?.startsWith(`第 ${n} 集`))
  if (!tr) throw new Error(`No row ${n}`)
  return tr
}
function rowAction(n: number) {
  return Array.from(row(n).querySelectorAll('button')).at(
    -1
  ) as HTMLButtonElement
}
function text() {
  return document.body.innerText
}
async function location(path: string) {
  await until(
    () => document.querySelector('#location')?.textContent === path,
    `route ${path}`
  )
}
async function routeBack(id: string) {
  navigate(`/project/${id}`)
  await ready()
}
async function suite() {
  createRoot(document.getElementById('root')!).render(<Shell />)
  await until(() => !!navigate, 'mounted')
  assert(text().includes('选择一个项目'), 'empty project choice is explicit')
  await w.testCapture('00-no-project')
  fixture('zero', 'script', 0)
  await select('zero')
  await ready()
  assert(text().includes('暂无集数'), 'zero episodes explains configuration')
  await w.testCapture('01-zero-episodes')
  const novel = fixture('novel', 'novel')
  novel.source = false
  await select('novel')
  await ready()
  assert(
    row(1).textContent?.includes('缺少小说原文'),
    'novel missing input is explicit'
  )
  assert(
    rowAction(1).textContent?.includes('剧情'),
    'novel missing source is earliest gate'
  )
  rowAction(1).click()
  await location('/project/novel/source')
  await until(() => text().includes('小说原文'), 'source consumer mounted')
  assert(
    calls.some(
      (x: any) =>
        x.method === 'readTextFile' &&
        String(x.args[0]).startsWith('/synthetic/novel/')
    ),
    'source destination consumes current project path'
  )
  await routeBack('novel')
  novel.source = true
  button('刷新').click()
  await ready()
  assert(
    rowAction(1).textContent?.includes('剧本'),
    'novel ready shared inventory advances to script'
  )
  await w.testCapture('02-novel-inventory')
  novel.usedEpisodeNumbers = [1]
  button('刷新').click()
  await ready()
  assert(
    row(1).textContent?.includes('库存已使用，需核对') &&
      rowAction(1).textContent?.includes('剧情'),
    'used inventory without script is not available input'
  )
  novel.usedEpisodeNumbers = []
  novel.source = false
  novel.chapterSource = true
  button('刷新').click()
  await ready()
  assert(
    rowAction(1).textContent?.includes('剧本'),
    'chapter-based source is accepted without an aggregate novel file'
  )
  const story = fixture('story', 'story')
  story.episodes[2].hasStoryBeat = true
  await select('story')
  await ready()
  assert(
    row(3).textContent?.includes('待审核'),
    'story artifact alone does not pass review'
  )
  rowAction(3).focus()
  await w.testKeys('Enter')
  await location('/project/story/story?ep=3')
  await until(
    () => text().includes('EP03'),
    'story editor consumes episode query'
  )
  assert(
    calls.some(
      (x: any) =>
        x.method === 'readTextFile' &&
        /\/synthetic\/story\/.*ep03/i.test(x.args[0])
    ),
    'story consumer reads EP03 in selected project'
  )
  await routeBack('story')
  await w.testCapture('03-story-entry')
  const script = fixture('script', 'script')
  await select('script')
  await ready()
  assert(
    row(1).textContent?.includes('不适用'),
    'script entry marks story not applicable'
  )
  const before = calls.filter(
    (x: any) => x.method === 'getPlotBreakdownSummary'
  ).length
  rowAction(2).click()
  await location('/project/script/script?ep=2')
  await until(() => text().includes('EP02'), 'script editor consumes EP02')
  assert(
    calls.some(
      (x: any) =>
        x.method === 'readTextFile' &&
        /\/synthetic\/script\/.*ep02/i.test(x.args[0])
    ),
    'script consumer reads selected project and episode'
  )
  await routeBack('script')
  assert(
    calls.filter((x: any) => x.method === 'getPlotBreakdownSummary').length ===
      before,
    'script entry never reads novel inventory'
  )
  await w.testCapture('04-script-entry')
  script.episodes[0] = {
    ...script.episodes[0],
    hasScript: true,
    hasScriptReview: true,
    hasDirectorAnalysis: true,
    hasArtDesign: true,
    hasSeedancePrompts: true
  }
  script.pipeline.episodes['1'] = {
    stageStates: { director: { status: 'stale' }, art: { status: 'passed' } }
  }
  button('刷新').click()
  await ready()
  assert(
    rowAction(1).textContent?.includes('导演'),
    'invalid director review stays earliest gate'
  )
  assert(
    row(1).textContent?.includes('需要更新审核'),
    'invalid review has a text status'
  )
  rowAction(1).click()
  await location('/project/script/prompts?ep=1&tab=director')
  await until(
    () =>
      document.querySelector('.tab-btn.active')?.textContent?.includes('导演'),
    'prompt consumes director tab'
  )
  assert(text().includes('EP01'), 'prompt consumes episode query')
  await routeBack('script')
  const artButton = row(1)
    .querySelectorAll('td')[3]
    .querySelector('button') as HTMLButtonElement
  artButton.click()
  await location('/project/script/prompts?ep=1&tab=art')
  await until(
    () =>
      document
        .querySelector('.tab-btn.active')
        ?.textContent?.includes('服化道'),
    'prompt consumes art tab'
  )
  await routeBack('script')
  const promptsButton = row(1)
    .querySelectorAll('td')[4]
    .querySelector('button') as HTMLButtonElement
  promptsButton.click()
  await location('/project/script/prompts?ep=1&tab=prompts')
  await until(
    () =>
      document
        .querySelector('.tab-btn.active')
        ?.textContent?.includes('提示词'),
    'prompt consumes storyboard tab'
  )
  await routeBack('script')
  script.pipeline.episodes['1'].stageStates.director.status = 'passed'
  script.episodes[0].hasStoryboardReview = true
  button('刷新').click()
  await ready()
  assert(
    row(1).textContent?.includes('有效门禁均满足'),
    'completed row requires every applicable current gate'
  )
  const checkbox = document.querySelector(
    '.production-toolbar input'
  ) as HTMLInputElement
  checkbox.click()
  await delay()
  assert(
    !Array.from(document.querySelectorAll('.production-table tbody tr')).some(
      (el) => el.querySelector('th')?.textContent?.startsWith('第 1 集')
    ),
    'pending filter removes completed episodes'
  )
  checkbox.click()
  await delay()
  script.error = 'getProjectPipelineState'
  button('刷新').click()
  await ready()
  assert(
    text().includes('部分状态未知'),
    'partial snapshot failure is explicit'
  )
  assert(
    !row(1).textContent?.includes('有效门禁均满足'),
    'snapshot failure cannot reuse previous approval'
  )
  await w.testCapture('05-partial-failure')
  const bad = fixture('bad')
  bad.error = 'all'
  await select('bad')
  await ready()
  assert(
    text().includes('分集状态读取失败'),
    'complete read failure is explicit'
  )
  assert(
    !document.querySelector('.production-table') &&
      !text().includes('执行失败'),
    'unknown data is not a failure verdict'
  )
  await w.testCapture('06-read-failure')
  const a = fixture('lateA', 'novel')
  a.defer = true
  await select('lateA')
  await until(() => deferred.length >= 4, 'A requests deferred')
  const b = fixture('currentB')
  await select('currentB')
  await ready()
  usePipelineStore.setState({
    isRunning: true,
    context: { projectId: 'lateA', episodeNum: 2, currentStage: 'art' } as any
  })
  await until(
    () => text().includes('后台任务：项目 lateA'),
    'running identity separated'
  )
  for (const d of deferred.splice(0)) d.resolve()
  await delay(150)
  assert(
    text().includes('合成currentB') && !text().includes('合成lateA'),
    'late A results cannot replace current B'
  )
  assert(
    useProjectStore
      .getState()
      .episodes.every((ep) => ep.projectId === 'currentB'),
    'late reads cannot contaminate project store'
  )
  await w.testCapture('07-cross-project-run')
  a.defer = false
  button('查看运行任务').click()
  await location('/project/lateA/pipeline?ep=2')
  await until(
    () =>
      useProjectStore.getState().currentProject?.id === 'lateA' &&
      text().includes('02'),
    'running task navigation consumes project and episode'
  )
  assert(
    useProjectStore.getState().currentProject?.id === 'lateA',
    'existing route sync loads the running project separately'
  )
  await select('currentB')
  await ready()
  usePipelineStore.setState({ isRunning: false, context: null })
  b.defer = true
  button('刷新').click()
  await until(() => text().includes('正在读取制作状态'), 'refresh state shown')
  assert(rowAction(1).disabled, 'next action disabled during refresh')
  await w.testCapture('08-refreshing')
  b.defer = false
  for (const d of deferred.splice(0)) d.resolve()
  await ready()
  fixture('big', 'script', 123)
  await select('big')
  await ready()
  assert(
    document.querySelectorAll('.production-table tbody tr').length === 20,
    'large projects render only 20 rows'
  )
  button('下一页').focus()
  await w.testKeys('Enter')
  await delay()
  assert(
    row(21) &&
      document.querySelectorAll('.production-table tbody tr').length === 20,
    'pagination advances with keyboard'
  )
  assert(
    (document.activeElement as HTMLElement)?.textContent?.includes('下一页'),
    'pagination keeps keyboard focus'
  )
  await w.testResize(390)
  await delay(100)
  const pageScroll = document.querySelector('.app-content') as HTMLElement
  assert(
    pageScroll.scrollWidth <= pageScroll.clientWidth + 1,
    `main content has no horizontal overflow (${pageScroll.scrollWidth}/${pageScroll.clientWidth})`
  )
  assert(
    document.documentElement.scrollWidth <=
      document.documentElement.clientWidth + 1,
    `narrow viewport has no page overflow (${document.documentElement.scrollWidth}/${document.documentElement.clientWidth})`
  )
  const region = document.querySelector(
    '.production-table-scroll'
  ) as HTMLElement
  assert(
    region.scrollWidth > region.clientWidth,
    'matrix horizontal scroll stays inside labelled region'
  )
  pageScroll.scrollTop = 0
  region.scrollLeft = region.scrollWidth
  await w.testCapture('09-narrow-right')
  region.scrollLeft = 0
  region.scrollIntoView({ block: 'start' })
  await w.testCapture('10-narrow-left')
  const refresh = button('刷新')
  refresh.focus()
  await delay()
  assert(
    getComputedStyle(refresh).outlineStyle === 'solid',
    'focused action has visible outline'
  )
  const networkCalls = calls.filter((x: any) =>
    String(x.method).startsWith('FORBIDDEN:')
  )
  assert(
    networkCalls.length === 0,
    'no production writes, run requests, or unimplemented API calls occurred'
  )
  assert(
    calls.filter(
      (x: any) => x.method === 'syncProjectStatus' && x.args[0] === 'big'
    ).length === 1,
    'large project performs one status query, not per-episode fanout'
  )
  await w.testFinish({
    ok: true,
    checks,
    calls,
    boundary:
      'Real isolated Electron DOM with actual ProjectPage/controller/stores/view model and existing destination pages; synthetic read API; no production backend or model execution; no document paragraph targeting claimed.'
  })
}
suite().catch((error) =>
  w.testFinish({
    ok: false,
    checks,
    error: String(error),
    stack: error.stack,
    text: text(),
    calls
  })
)
