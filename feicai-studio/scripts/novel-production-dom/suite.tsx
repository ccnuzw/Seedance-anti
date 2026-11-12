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
import { MODE_MAP } from '@shared/batch'
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
  useProjectStore.setState({
    episodes: [{ ...episode, scriptPath: '/synthetic/novel/script/ep01.md' }]
  })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('查看并审核剧本')
  )
  ;(document.querySelector('.command-next button') as HTMLButtonElement).click()
  await until(
    () =>
      document.querySelector('#location')?.textContent ===
      '/project/novel/script?ep=1'
  )
  assert(true, 'existing script path primary opens script without regenerating')
  navigate('/pipeline')
  useProjectStore.setState({ episodes: [{ ...episode, projectId: 'foreign' }] })
  await until(() =>
    document
      .querySelector('.command-next button')
      ?.textContent?.includes('刷新集状态')
  )
  assert(true, 'unknown current project episode primary requests refresh')
  useProjectStore.setState({ episodes: [episode] })
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
  let rejectBackend: any
  w.feicaiAPI.getPipelineState = () =>
    new Promise((_resolve, reject) => {
      rejectBackend = reject
    })
  navigate('/batch')
  await until(() => !!document.querySelector('.batch-command-center'))
  const startButton = () =>
    document.querySelector(
      '.batch-command-buttons .btn-primary'
    ) as HTMLButtonElement
  await until(() => !!rejectBackend)
  assert(
    startButton().disabled,
    'pending backend read blocks batch start even after summary arrives'
  )
  rejectBackend(new Error('synthetic background failure'))
  await until(() => document.body.innerText.includes('后台任务状态读取失败'))
  assert(startButton().disabled, 'failed backend read blocks batch start')
  w.feicaiAPI.getPipelineState = async () => ({
    state: 'director',
    projectId: 'another'
  })
  const recheck = () =>
    [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重新检查后台任务')
    )!
  recheck().click()
  await until(() => document.body.innerText.includes('后台有流水线任务'))
  assert(
    startButton().disabled,
    'other project backend work blocks batch start'
  )
  w.feicaiAPI.getPipelineState = async () => ({ state: 'idle' })
  // Remount performs the same query after the external task has ended.
  navigate('/other')
  await delay()
  navigate('/batch')
  await until(() => startButton() && !startButton().disabled)

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
        {
          episodeNum: 1,
          batchNumber: 7,
          status: 'error',
          progress: '剧情点为零，审核失败'
        }
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
  usePipelineStore.setState({
    logs: [
      {
        level: 'error',
        message: '合成失败日志',
        timestamp: Date.now(),
        type: 'review_fail'
      }
    ] as any
  })
  await until(() => !!document.querySelector('.batch-log-title'))
  assert(
    !document.querySelector('.batch-log-body'),
    'failure remains discoverable with logs collapsed'
  )
  assert(
    document
      .querySelector('[role="alert"]')
      ?.textContent?.includes('第 7 批剧情'),
    'failed draft identifies its real batch number'
  )
  ;(document.querySelector('.batch-log-title') as HTMLButtonElement).click()
  await until(() => !!document.querySelector('.batch-log-body'))
  ;(document.querySelector('.batch-log-title') as HTMLButtonElement).click()
  await until(() => !document.querySelector('.batch-log-body'))
  for (const [status, label] of [
    ['paused', '队列已暂停'],
    ['stopped', '队列已停止'],
    ['interrupted', '队列已中断'],
    ['idle', '队列尚未启动'],
    ['error', '队列执行失败']
  ]) {
    useBatchStore.setState({
      snapshot: { ...useBatchStore.getState().snapshot!, status } as any
    })
    await until(() => document.body.innerText.includes(label))
    assert(true, `queue state ${status} is accurately labeled`)
  }
  useBatchStore.setState({ snapshot: null })
  for (const [entry, expected] of [
    ['novel', 'smart_next'],
    ['story', 'script'],
    ['script', 'full']
  ] as const) {
    navigate('/other')
    await delay()
    useProjectStore.setState({
      currentProject: {
        ...project,
        config: { ...project.config, entryStage: entry }
      }
    })
    navigate('/batch')
    await until(() =>
      document
        .querySelector('.batch-mode-option.active')
        ?.textContent?.includes(MODE_MAP[expected].label)
    )
    assert(true, `${entry} without URL mode uses ${expected}`)
    if (entry !== 'novel') {
      assert(
        (
          document
            .querySelector('.batch-selection')!
            .closest('details') as HTMLDetailsElement
        ).open,
        `${entry} episode selection visible without advanced modes`
      )
      ;(
        document.querySelector('.episode-select-btn') as HTMLButtonElement
      ).click()
      await until(() => !startButton().disabled)
    }
  }
  navigate('/batch?mode=script_review')
  await until(() =>
    document
      .querySelector('.batch-mode-option.active')
      ?.textContent?.includes(MODE_MAP.script_review.label)
  )
  assert(true, 'explicit URL mode remains compatible')
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
