/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import AppShell from '@renderer/components/layout/AppShell'
import { useTaskCenterStore } from '@renderer/stores/taskCenterStore'
import { useProjectStore } from '@renderer/stores/projectStore'
import '@renderer/styles/theme.css'
import '@renderer/styles/global.css'
const w = window as any
const fixture = w.fixture
const checks: string[] = []
const sleep = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message)
  checks.push(message)
}
const until = async (predicate: () => unknown) => {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return
    await sleep(30)
  }
  throw new Error('Timed out waiting for DOM condition')
}
const text = () => document.body.textContent || ''
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent === label
  )
const refresh = async () => {
  await useTaskCenterStore.getState().refresh()
  await sleep()
}
const task = (kind: string, runId: string, status = 'running') => ({
  identity: {
    projectId: 'a',
    taskId: runId,
    runId,
    episodeNum: 4,
    stage: kind === 'workflow' ? 'story_review' : 'director'
  },
  kind,
  status,
  settings: {}
})
async function main() {
  useProjectStore.setState({
    projects: [
      { id: 'a', name: '合成项目 A' },
      { id: 'b', name: '合成项目 B' }
    ] as any,
    currentProject: null
  })
  createRoot(document.getElementById('root')!).render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="*"
            element={
              <main>
                <h1>受控模块内容</h1>
                <Link to="/project/b/review">切换审核模块</Link>
                <button id="page-action">页面主动作</button>
              </main>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>
  )
  await until(() => document.querySelector('.task-center-bar'))
  await refresh()
  button('任务中心')!.click()
  await sleep()
  assert(
    text().includes('上次应用退出前') && text().includes('结果未知'),
    'Restart without receipts explicitly remains unknown'
  )
  button('关闭')!.click()
  await sleep()
  fixture.tasks = [task('pipeline', 'pipeline-1')]
  fixture.execution = { busy: true, phase: 'running', owner: 'pipeline' }
  fixture.listeners.task()
  await sleep(150)
  await refresh()
  const bar = () =>
    document.querySelector('.task-center-bar')!.textContent || ''
  assert(
    bar().includes('合成项目 A') && bar().includes('运行中'),
    'Pipeline started from settings appears globally'
  )
  ;(document.querySelector('main a') as HTMLElement).click()
  await sleep()
  useProjectStore.setState({
    currentProject: { id: 'b', name: '合成项目 B', totalEpisodes: 0 } as any
  })
  await sleep()
  assert(
    bar().includes('合成项目 A') && !bar().includes('合成项目 B'),
    'Route and project switch retain backend project A identity'
  )
  button('任务中心')!.click()
  await sleep()
  assert(document.querySelector('dialog')?.open, 'Drawer opens as a modal')
  assert(
    document.querySelector('dialog')!.contains(document.activeElement),
    'Keyboard focus enters drawer'
  )
  button('暂停')!.click()
  await sleep(200)
  await refresh()
  assert(
    text().includes('已暂停') && !!button('继续'),
    'Pause is authoritative and only resume/stop remain'
  )
  assert(
    fixture.calls.at(-1).args[0].target.projectId === 'a' &&
      fixture.calls.at(-1).args[0].target.runId === 'pipeline-1',
    'Pause targets original identity after project switch'
  )
  button('继续')!.click()
  await sleep(200)
  await refresh()
  fixture.stopping = new Promise<void>((resolve) => {
    fixture.finishStop = resolve
  })
  button('停止')!.click()
  await sleep(200)
  await refresh()
  assert(
    text().includes('停止处理中') &&
      !button('暂停') &&
      !button('继续') &&
      !button('停止'),
    'Stopping provider disables conflicting controls until settlement'
  )
  fixture.finishStop()
  await sleep(200)
  await refresh()
  assert(text().includes('已停止'), 'Stopped is shown only after settlement')
  button('确认结果')!.click()
  await sleep()
  button('关闭')!.click()
  await sleep()
  fixture.tasks = [task('workflow', 'workflow-2')]
  fixture.execution = { busy: true, phase: 'running', owner: 'workflow' }
  fixture.listeners.task()
  await sleep(150)
  await refresh()
  assert(
    bar().includes('合成项目 A') && bar().includes('运行中'),
    'Standalone workflow remains visible outside its module'
  )
  button('任务中心')!.click()
  await sleep()
  assert(
    text().includes('独立工作流') &&
      text().includes('服务未提供细分步骤进度') &&
      !document.querySelector('dialog')!.textContent!.includes('%'),
    'Workflow shows only available review state without invented step totals or percentages'
  )
  fixture.fail = true
  await refresh()
  assert(
    text().includes('状态未知') && !button('暂停') && !button('停止'),
    'API failure fails closed and offers refresh'
  )
  fixture.fail = false
  fixture.tasks[0].status = 'completed'
  fixture.execution = { busy: false, phase: 'idle' }
  await refresh()
  button('关闭')!.click()
  await sleep()
  assert(
    bar().includes('已完成'),
    'Completed sticky result survives drawer close'
  )
  fixture.listeners.task({ identity: { runId: 'old' }, status: 'failed' })
  await sleep(180)
  await refresh()
  assert(
    bar().includes('已完成'),
    'Delayed old-run event cannot overwrite authoritative completion'
  )
  button('任务中心 (1)')!.click()
  await sleep()
  button('确认结果')!.click()
  await sleep()
  fixture.tasks = [task('workflow', 'workflow-3', 'failed')]
  await refresh()
  button('关闭')!.click()
  await sleep()
  assert(
    bar().includes('失败'),
    'Failed sticky result survives route/drawer changes until acknowledgment'
  )
  fixture.queue = {
    id: 'q',
    projectId: 'a',
    projectPath: '/synthetic-only',
    mode: 'story',
    status: 'completed',
    cursor: 2,
    updatedAt: 'now',
    tasks: [
      {
        episodeNum: 1,
        batchNumber: 8,
        status: 'error',
        progress: '合成审核失败',
        steps: {}
      },
      { episodeNum: 2, batchNumber: 9, status: 'done', steps: {} }
    ]
  }
  fixture.tasks = [task('workflow', 'batch-last-child', 'completed')]
  await refresh()
  assert(
    bar().includes('1 项失败'),
    'Queue failure is not hidden by its last successful child task'
  )
  button('任务中心 (3)')!.click()
  await sleep()
  assert(
    text().includes('队列已遍历完成 · 1 项失败') &&
      text().includes('合成审核失败'),
    'Completed queue preserves individual task failure'
  )
  await w.testResize(390)
  await sleep()
  const drawer = document.querySelector('dialog')!
  assert(
    drawer.getBoundingClientRect().width <= 390 && drawer.scrollWidth <= 390,
    '390px drawer has no horizontal overlap/overflow'
  )
  const close = button('关闭')!
  close.focus()
  await w.testKeys('Tab')
  await sleep()
  assert(
    drawer.contains(document.activeElement),
    'Native dialog traps keyboard focus'
  )
  await w.testKeys('Escape')
  await sleep()
  assert(
    !drawer.open && document.activeElement?.textContent?.startsWith('任务中心'),
    'Escape closes drawer and restores trigger focus'
  )
  const barRect = document
    .querySelector('.task-center-bar')!
    .getBoundingClientRect()
  const actionRect = document
    .getElementById('page-action')!
    .getBoundingClientRect()
  assert(
    barRect.right <= 390 &&
      actionRect.top >= barRect.bottom &&
      actionRect.right <= 390,
    '390px global bar does not cover page primary action'
  )
  await w.testFinish({ ok: true, checks })
}
void main().catch((error) =>
  w.testFinish({ ok: false, error: String(error), stack: error.stack, checks })
)
