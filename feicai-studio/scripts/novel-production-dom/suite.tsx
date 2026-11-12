/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate
} from 'react-router-dom'
import BatchPage from '@renderer/pages/BatchPage'
import PipelinePage from '@renderer/pages/PipelinePage'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { useBatchStore } from '@renderer/stores/batchStore'
import '@renderer/styles/theme.css'
import '@renderer/styles/global.css'
const w = window as any
const checks: string[] = []
const delay = () => new Promise((resolve) => setTimeout(resolve, 40))
function assert(value: unknown, label: string) {
  if (!value) throw new Error(label)
  checks.push(label)
}
async function until(check: () => unknown) {
  for (let i = 0; i < 150; i++) {
    if (check()) return
    await delay()
  }
  throw new Error(document.body.innerText)
}
let navigate: any
function Observer() {
  navigate = useNavigate()
  const l = useLocation()
  return <output id="location">{l.pathname + l.search}</output>
}
async function suite() {
  const project = {
    id: 'novel',
    name: '合成小说',
    projectPath: '/synthetic/novel',
    totalEpisodes: 1,
    config: { entryStage: 'novel', projectName: '合成小说', totalEpisodes: 1 },
    updatedAt: ''
  } as any
  const episode = {
    projectId: 'novel',
    episodeNumber: 1,
    id: 'novel-1',
    status: 'idle',
    updatedAt: ''
  } as any
  const waterline = {
    readyEpisodeNumbers: [],
    usedEpisodeNumbers: [],
    totalSourceChapters: 10,
    nextActionMode: 'breakdown',
    nextActionLabel: '准备剧情',
    unprocessedChapterCount: 10
  }
  w.fixtureState.fixtures.novel = { project, episodes: [episode], waterline }
  useProjectStore.setState({ currentProject: project, episodes: [episode] })
  w.feicaiAPI.getBatchState = async () => null
  w.feicaiAPI.onBatchState = () => () => {}
  createRoot(document.getElementById('root')!).render(
    <MemoryRouter initialEntries={['/pipeline']}>
      <Observer />
      <Routes>
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/batch" element={<BatchPage />} />
        <Route path="*" element={<p>合成导航目的地</p>} />
      </Routes>
    </MemoryRouter>
  )
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('准备剧情草稿')
  )
  const primary = document.querySelector(
    '.command-next button'
  ) as HTMLButtonElement
  assert(!primary.disabled, 'empty inventory offers preparation navigation')
  primary.click()
  await until(
    () =>
      document.querySelector('#location')?.textContent ===
      '/project/novel/story?ep=1'
  )
  assert(true, 'command primary navigates to story slot without generation')
  navigate('/pipeline')
  waterline.readyEpisodeNumbers = [1] as never[]
  useProjectStore.setState({
    currentProject: { ...project, updatedAt: 'ready' }
  })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('剧本生成')
  )
  assert(
    !document
      .querySelector('.command-next')
      ?.textContent?.includes('先让本集剧情'),
    'shared inventory bypasses episode story review'
  )
  usePipelineStore.setState({ isRunning: true })
  await until(
    () =>
      (document.querySelector('.command-next button') as HTMLButtonElement)
        ?.disabled
  )
  assert(true, 'busy engine blocks another script start')
  usePipelineStore.setState({ isRunning: false })
  waterline.usedEpisodeNumbers = [1] as never[]
  useProjectStore.setState({
    currentProject: { ...project, updatedAt: 'used' }
  })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('核对已用剧情')
  )
  assert(true, 'used inventory cannot generate another script')
  w.fixtureState.fixtures.novel.error = 'getPlotBreakdownSummary'
  useProjectStore.setState({
    currentProject: { ...project, updatedAt: 'failed' }
  })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('刷新准备状态')
  )
  assert(true, 'failed waterline read offers refresh')
  delete w.fixtureState.fixtures.novel.error
  waterline.usedEpisodeNumbers = []
  w.fixtureState.fixtures.novel.defer = true
  useProjectStore.setState({
    currentProject: { ...project, updatedAt: 'late' }
  })
  await until(() => w.fixtureState.deferred.length > 0)
  const other = { ...project, id: 'other', projectPath: '/synthetic/other' }
  w.fixtureState.fixtures.other = {
    project: other,
    episodes: [{ ...episode, projectId: 'other' }],
    waterline: { ...waterline, readyEpisodeNumbers: [] }
  }
  useProjectStore.setState({
    currentProject: other,
    episodes: w.fixtureState.fixtures.other.episodes
  })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('准备剧情草稿')
  )
  for (const pending of w.fixtureState.deferred.splice(0)) pending.resolve()
  await delay()
  assert(
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('准备剧情草稿'),
    'late previous project readiness cannot unlock new project'
  )
  delete w.fixtureState.fixtures.novel.defer
  waterline.readyEpisodeNumbers = []
  useProjectStore.setState({ currentProject: project, episodes: [episode] })
  navigate('/batch')
  await until(() => !!document.querySelector('.batch-command-center'))
  const details = document.querySelector('details')!
  assert(!details.open, 'advanced modes initially collapsed')
  const summary = details.querySelector('summary')!
  summary.focus()
  await w.testKeys('Enter')
  await until(() => details.open)
  assert(
    details.querySelectorAll('.batch-mode-option').length === 13,
    'keyboard opens all thirteen advanced modes'
  )
  assert(
    document.body.innerText.includes('生成剧情草稿并审核入库'),
    'smart next describes only its actual preparation step'
  )
  useBatchStore.setState({
    snapshot: {
      id: 'synthetic-queue',
      status: 'completed',
      mode: 'smart_next',
      cursor: 1,
      tasks: [
        { episodeNum: 1, status: 'error', progress: '剧情点为零，审核失败' }
      ],
      updatedAt: 1
    } as any
  })
  await until(() =>
    document
      .querySelector('[role="alert"]')
      ?.textContent?.includes('剧情点为零')
  )
  assert(
    document.body.innerText.includes('队列已结束，存在失败任务'),
    'completed with error is visibly failed'
  )
  assert(
    !document.querySelector('.batch-log-list'),
    'failure remains discoverable with logs collapsed'
  )
  await w.testResize(390)
  await delay()
  assert(
    document.documentElement.scrollWidth <= window.innerWidth + 2,
    'batch controls fit narrow viewport'
  )
  assert(
    !w.fixtureState.calls.some((call: any) =>
      call.method.startsWith('FORBIDDEN:')
    ),
    'no generation or production API used'
  )
  w.testFinish({ ok: true, checks })
}
suite().catch((error) =>
  w.testFinish({
    ok: false,
    error: String(error),
    stack: error.stack,
    checks,
    calls: w.fixtureState.calls
  })
)
