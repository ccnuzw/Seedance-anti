/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import AppShell from '@renderer/components/layout/AppShell'
import ProjectRouteSync from '@renderer/components/layout/ProjectRouteSync'
import Project from '@renderer/pages/ProjectPage'
import Batch from '@renderer/pages/BatchPage'
import Story from '@renderer/pages/StoryBeatEditorPage'
import Source from '@renderer/pages/SourceEditorPage'
import { useProjectStore } from '@renderer/stores/projectStore'
import { useTaskCenterStore } from '@renderer/stores/taskCenterStore'
import { useBatchStore } from '@renderer/stores/batchStore'
import { useToastStore } from '@renderer/stores/toastStore'
import '@renderer/styles/theme.css'
import '@renderer/styles/global.css'
const w = window as any
const f = w.fixture
const checks: string[] = []
const delay = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
const text = () => document.body.innerText
function assert(ok: unknown, message: string) {
  if (!ok) throw new Error(message)
  checks.push(message)
}
async function until(predicate: () => unknown) {
  for (let i = 0; i < 160; i++) {
    if (predicate()) return
    await delay()
  }
  throw new Error(`等待页面超时：${text()}`)
}
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.trim().startsWith(label)
  )
async function click(label: string) {
  await until(() => button(label) && !button(label)!.disabled)
  button(label)!.click()
  await delay()
}
async function refresh() {
  await useTaskCenterStore.getState().refresh()
  await delay()
}
const bar = () => document.querySelector('.task-center-bar')!.textContent || ''
const start = () =>
  document.querySelector<HTMLButtonElement>(
    '.batch-command-buttons .btn-primary'
  )!
async function reachable(element: HTMLElement, label: string) {
  element.scrollIntoView({ block: 'center' })
  element.focus()
  await delay()
  const rect = element.getBoundingClientRect()
  const hit = element.contains(
    document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    )
  )
  const ok =
    document.activeElement === element &&
    rect.left >= 0 &&
    rect.right <= innerWidth + 1 &&
    rect.top >= 0 &&
    rect.bottom <= innerHeight &&
    hit
  if (!ok) {
    await w.testCapture('unreachable-action')
    throw new Error(
      `${label}: ${JSON.stringify({ rect: rect.toJSON(), viewport: [innerWidth, innerHeight], focused: document.activeElement === element, hit })}`
    )
  }
  assert(ok, label)
}
async function main() {
  useProjectStore.setState({ projects: Object.values(f.projects) as any })
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          {
            path: '/project/:id',
            element: <ProjectRouteSync />,
            children: [
              { index: true, element: <Project /> },
              { path: 'batch', element: <Batch /> },
              { path: 'story', element: <Story /> },
              { path: 'source', element: <Source /> }
            ]
          }
        ]
      }
    ],
    { initialEntries: ['/project/a/story?ep=1'] }
  )
  createRoot(document.getElementById('root')!).render(
    <RouterProvider router={router} />
  )
  await until(() => button('生成剧情草稿') && !button('生成剧情草稿')!.disabled)
  await reachable(
    button('生成剧情草稿')!,
    '桌面剧情生成主按钮可聚焦且未被全局任务栏覆盖'
  )
  await click('生成剧情草稿')
  await until(() => f.finishGeneration)
  await refresh()
  assert(
    f.calls.filter((c: any) => c.method === 'runStoryGeneration').length ===
      1 &&
      bar().includes('验收项目 A') &&
      bar().includes('运行中'),
    '真实剧情页点击经过准入后启动独立任务并出现在全局栏'
  )
  await router.navigate('/project/b/batch?mode=script')
  await until(
    () =>
      useProjectStore.getState().currentProject?.id === 'b' &&
      document.querySelector('.batch-bg-banner')
  )
  assert(
    bar().includes('验收项目 A') &&
      !bar().includes('验收项目 B') &&
      start().disabled,
    '路由同步切换项目 B 的真实批量页仍保留项目 A 任务并禁用启动'
  )
  assert(
    document
      .querySelector('.batch-bg-banner')!
      .textContent!.includes('后台制作任务'),
    '另一项目批量页说明后台忙碌而不显示当前项目的错误控制目标'
  )
  await w.testCapture('workflow-cross-project-desktop')
  await click('任务中心')
  const dialog = document.querySelector('dialog')!
  assert(
    dialog.open && dialog.contains(document.activeElement),
    '实际项目页任务抽屉打开后接收焦点'
  )
  await w.testResize(390)
  await delay()
  await reachable(button('关闭')!, '390px 抽屉关闭操作可聚焦且可点击')
  await w.testCapture('workflow-cross-project-390')
  await w.testKeys('Escape')
  await until(() => !dialog.open)
  assert(
    document.activeElement?.textContent?.includes('任务中心'),
    '实际路由页面按 Escape 关闭并归还任务栏焦点'
  )
  f.finishGeneration()
  await refresh()
  await until(() => bar().includes('已完成'))
  await router.navigate('/project/b')
  await until(() =>
    document.querySelector('.project-name')?.textContent?.includes('验收项目 B')
  )
  assert(
    bar().includes('已完成'),
    '原页面卸载后任务完成结果仍在项目 B 详情页显示'
  )
  await click('任务中心')
  await click('确认结果')
  await click('关闭')
  await refresh()
  assert(!bar().includes('已完成'), '终态确认后真实页面任务栏解除粘性结果')
  await w.testResize(1360)
  await router.navigate('/project/b/story?ep=1')
  await click('生成剧情草稿')
  await until(() => f.runCount === 2)
  await refresh()
  assert(
    bar().includes('验收项目 B') &&
      bar().includes('运行中') &&
      !bar().includes('验收项目 A'),
    '确认旧结果后新项目通过真实生成按钮切换到新任务身份'
  )
  await router.navigate('/project/b/batch?mode=script')
  await until(() =>
    document
      .querySelector('.batch-bg-banner')
      ?.textContent?.includes('独立工作流')
  )
  assert(
    start().disabled && !!button('暂停后台任务') && !!button('停止后台任务'),
    '同项目独立工作流忙碌时批量页禁用启动并提供准确的后台控制入口'
  )
  f.finishGeneration()
  await refresh()
  await click('任务中心')
  await click('确认结果')
  await click('关闭')
  await router.navigate('/project/b/batch?mode=script')
  await until(() => start() && document.querySelector('.episode-select-btn'))
  await until(() => !document.querySelector('.batch-bg-banner'))
  assert(start().disabled, '独立任务空闲但未选集时真实批量页仍禁用执行')
  const episodeButtons = () => [
    ...document.querySelectorAll<HTMLButtonElement>('.episode-select-btn')
  ]
  episodeButtons()[1].click()
  await until(() => !start().disabled)
  assert(
    document.querySelectorAll('.episode-select-btn.selected').length === 1 &&
      start().textContent?.includes('1 集'),
    '点击 EP02 后仅该集选中并解锁批量按钮'
  )
  f.failStatus = true
  await until(() => text().includes('后台任务状态读取失败'))
  assert(start().disabled, '已选集后后台查询失败也禁用批量执行')
  f.failStatus = false
  await click('重新检查后台任务')
  await until(() => !start().disabled)
  assert(true, '重新检查真实按钮在权威空闲后恢复选集启动能力')
  await w.testCapture('batch-selection-desktop')
  await w.testResize(390)
  await reachable(start(), '390px 批量执行主按钮可聚焦且可点击')
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    '带 AppShell 的390px批量页无整页横向溢出'
  )
  await w.testCapture('batch-selection-390')
  start().click()
  await until(() => f.calls.some((c: any) => c.method === 'startBatch'))
  const command = f.calls.find((c: any) => c.method === 'startBatch').args[0]
  assert(
    command.projectId === 'b' &&
      command.mode === 'script' &&
      JSON.stringify(command.episodes) === '[2]',
    '真实批量启动接线仅把项目 B 的 EP02 和 script 模式交给受控 API'
  )
  f.queue = null
  f.execution = { busy: false, phase: 'idle' }
  f.tasks = []
  await router.navigate('/project/b')
  await until(() => button('⚙️ 设置'))
  await click('⚙️ 设置')
  const nameInput = () =>
    document.querySelector<HTMLInputElement>('#project-name')!
  await until(() => nameInput()?.value === '验收项目 B')
  await reachable(nameInput(), '390px 项目名称字段具有关联标签并可键盘聚焦')
  assert(
    document.querySelector('label[for="project-name"]')?.textContent ===
      '项目名称',
    '基础设置字段标签关联到真实输入框'
  )
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )!.set!.call(nameInput(), '项目 B 已保存')
  nameInput().dispatchEvent(new Event('input', { bubbles: true }))
  await delay()
  await reachable(button('💾 保存')!, '390px 项目设置保存操作可聚焦且可点击')
  await click('💾 保存')
  await until(() =>
    document
      .querySelector('.toast-warning')
      ?.textContent?.includes('项目设置已保存，但剧情规划状态刷新失败')
  )
  assert(
    f.calls.filter((c: any) => c.method === 'saveProjectSettings').length ===
      1 &&
      document
        .querySelector('.project-name')
        ?.textContent?.includes('项目 B 已保存'),
    '设置成功后摘要失败仍更新项目头且只保存一次'
  )
  assert(
    !document
      .querySelector('.toast-error')
      ?.textContent?.includes('保存失败') &&
      document
        .querySelector('.toast-success')
        ?.textContent?.includes('项目设置已保存'),
    '真实设置处理器同时给出保存成功和摘要警告而不误报保存失败'
  )
  assert(
    !button('💾 保存')!.disabled && nameInput().value === '项目 B 已保存',
    '摘要失败后设置表单保留成功值且可继续操作'
  )
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    '390px项目矩阵与设置表单无整页横向溢出'
  )
  await delay(350)
  assert(
    [...document.querySelectorAll<HTMLElement>('.toast')].every((toast) => {
      const rect = toast.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth
    }),
    '390px 保存成功与摘要警告通知完整显示且关闭按钮不被裁切'
  )
  const savedNotifications = useToastStore
    .getState()
    .toasts.map((toast) => toast.id)
  const bothNotificationsRemain = () =>
    savedNotifications.length === 2 &&
    savedNotifications.every((id) =>
      useToastStore
        .getState()
        .toasts.some(
          (toast) =>
            toast.id === id && !toast.exiting && toast.duration === 4000
        )
    )
  assert(
    bothNotificationsRemain(),
    '保存成功与摘要失败保留两条原始通知及默认4000ms时长'
  )
  const contentRect = document
    .querySelector('.app-content')!
    .getBoundingClientRect()
  const notificationsRect = document
    .querySelector('.toast-container')!
    .getBoundingClientRect()
  assert(
    contentRect.bottom <= notificationsRect.top + 1,
    '390px 双通知占用独立布局空间，不覆盖页面滚动内容'
  )
  await w.testCapture('project-settings-refresh-warning-390')
  await w.testResize(1360)
  await reachable(button('💾 保存')!, '桌面项目设置保存操作可聚焦且可点击')
  assert(
    getComputedStyle(document.querySelector('.toast-container')!).position ===
      'fixed' && bothNotificationsRemain(),
    '桌面双通知保留原固定布局和警告正文'
  )
  await w.testCapture('project-settings-refresh-warning-desktop')
  await click('任务中心')
  await reachable(
    button('关闭')!,
    '桌面双通知存在时任务抽屉关闭按钮可聚焦并命中'
  )
  await w.testCapture('task-dialog-with-notifications-desktop')
  await w.testKeys('Escape')
  await until(() => !document.querySelector('dialog')!.open)
  assert(
    document.activeElement?.textContent?.includes('任务中心'),
    '桌面双通知存在时 Escape 关闭抽屉并归还焦点'
  )
  f.failSummary = false
  f.files['/synthetic/b/story/episode-beats/ep01.md'] =
    '<!-- feicai-story-batch:7 -->\n待审草稿'
  f.ready = [2]
  f.used = [2]
  f.batch = 8
  f.reviewStatus = 'pending'
  await router.navigate('/project/b/story?ep=1')
  await until(() => button('保存并审核草稿'))
  assert(
    !button('生成下一批剧情草稿'),
    '真实路由待审草稿优先于下一批与已用库存'
  )
  await w.testCapture('novel-pending-desktop')
  await router.navigate('/project/b/source')
  await until(() => button('前往准备剧情草稿'))
  await w.testResize(390)
  await reachable(
    button('前往准备剧情草稿')!,
    '390px小说原文前往草稿操作可聚焦且可点击'
  )
  assert(
    bothNotificationsRemain(),
    '导航原文页时两条原始通知仍存在，未提前关闭或等待自动消失'
  )
  const sourceAction = button('前往准备剧情草稿')!
  const sourceRect = sourceAction.getBoundingClientRect()
  assert(
    sourceRect.bottom <=
      document.querySelector('.app-content')!.getBoundingClientRect().bottom +
        1,
    '原文主要动作正常滚动后位于双通知上方的内容视口'
  )
  await w.testCapture('source-dual-notifications-390')
  await w.testCapture('source-390')
  await w.testClick(
    sourceRect.left + sourceRect.width / 2,
    sourceRect.top + sourceRect.height / 2
  )
  await until(() => router.state.location.pathname.endsWith('/story'))
  assert(
    bothNotificationsRemain(),
    '双通知仍在时原文主动作通过真实指针命中并实际导航剧情页'
  )
  const warningClose = document.querySelector<HTMLButtonElement>(
    '.toast-warning .toast-close'
  )!
  await reachable(warningClose, '390px 警告通知关闭按钮可键盘聚焦并命中')
  await w.testKeys('Enter')
  await until(() =>
    document.querySelector('.toast-warning')?.classList.contains('toast-exit')
  )
  assert(true, '警告通知保留关闭操作并可通过键盘 Enter 关闭')
  assert(true, '真实原文页主要动作接到剧情页路由')
  f.reviewStatus = 'passed'
  f.ready = [1]
  f.used = [1]
  await router.navigate('/project/b')
  await until(() => button('核对已用剧情'))
  await w.testCapture('novel-used-without-script-390')
  await click('核对已用剧情')
  await until(
    () =>
      router.state.location.pathname.endsWith('/story') &&
      button('生成下一批剧情草稿')
  )
  assert(
    !button('前往可制作剧本'),
    '矩阵已用无剧本的主动作进入剧情核对且不重复生成本集剧本'
  )
  await reachable(
    button('生成下一批剧情草稿')!,
    '390px 下一批剧情草稿操作可聚焦且可点击'
  )
  assert(
    document
      .querySelectorAll('.document-command-step')[2]
      .textContent?.includes('等待下一批') &&
      !document
        .querySelectorAll('.document-command-step')[2]
        .textContent?.includes('先完成草稿审核'),
    '已通过但库存耗尽时制作步骤提示下一批，不误报等待审核'
  )
  await w.testCapture('novel-next-batch-390')
  await click('生成下一批剧情草稿')
  await until(() => f.runCount === 3)
  assert(
    f.calls.filter((c: any) => c.method === 'runStoryGeneration').at(-1).args[0]
      .batchNumber === 8,
    '真实路由下一批操作以第8批启动而非集数'
  )
  f.finishGeneration()
  await until(() => button('保存并审核草稿'))
  await reachable(
    button('保存并审核草稿')!,
    '390px 待审剧情草稿主要操作可聚焦且可点击'
  )
  await w.testCapture('novel-pending-390')
  await router.navigate('/project/b')
  await until(() => document.querySelector('.project-page'))
  f.reviewStatus = 'passed'
  f.ready = [1]
  f.used = []
  f.unknownEpisodes = true
  await router.navigate('/project/b/story?ep=1')
  await until(() => button('刷新核对集数'))
  assert(
    !button('前往可制作剧本') && !button('生成下一批剧情草稿'),
    '未知集数页面只提供核对入口且不越过剧本门禁'
  )
  assert(
    document
      .querySelectorAll('.document-command-step')[2]
      .textContent?.includes('集数待核对'),
    '未知集数的制作步骤与刷新核对主按钮保持一致'
  )
  await w.testCapture('novel-unknown-390')
  f.unknownEpisodes = false
  await click('刷新核对集数')
  await until(() => button('前往可制作剧本'))
  assert(true, '未知集恢复后真实刷新按钮解锁可制作剧本导航')
  await router.navigate('/project/b/batch?mode=script')
  await until(() => document.querySelector('.batch-page'))
  f.tasks = []
  f.queue = {
    id: 'interrupted-original-a',
    projectId: 'a',
    projectPath: '/synthetic/a',
    mode: 'script',
    status: 'interrupted',
    cursor: 1,
    tasks: [
      { episodeNum: 1, status: 'done', steps: { script: { success: true } } },
      { episodeNum: 2, status: 'pending', steps: {} }
    ],
    updatedAt: 10
  }
  f.execution = { busy: false, phase: 'idle' }
  await useBatchStore.getState().refresh()
  await refresh()
  await until(
    () => button('恢复未完成队列') && !button('恢复未完成队列')!.disabled
  )
  assert(start().disabled, 'interrupted 队列待核对时不能另启批量任务')
  await click('任务中心')
  const interruptedCard = () =>
    [...document.querySelectorAll<HTMLElement>('.task-center-card')].find(
      (card) => card.textContent?.includes('interrupted-original-a')
    )!
  await until(() => interruptedCard())
  assert(
    interruptedCard().textContent?.includes('验收项目 A') &&
      ![...interruptedCard().querySelectorAll('button')].some(
        (b) => b.textContent === '继续'
      ),
    '项目 B 的任务中心保留原项目 A 中断队列身份并引导来源页核对'
  )
  ;(interruptedCard().querySelector('a') as HTMLElement).click()
  await until(
    () =>
      router.state.location.pathname === '/project/a/batch' &&
      !document.querySelector('dialog')?.open
  )
  await until(
    () => button('恢复未完成队列') && !button('恢复未完成队列')!.disabled
  )
  assert(
    useProjectStore.getState().currentProject?.id === 'a',
    '中断队列来源链接实际同步到原项目 A 批量页'
  )
  f.failStatus = true
  await until(() => text().includes('后台任务状态读取失败'))
  assert(
    button('恢复未完成队列')!.disabled,
    '后台执行状态未知时中断队列恢复按钮禁用'
  )
  await refresh()
  await click('任务中心')
  assert(
    ![...interruptedCard().querySelectorAll('button')].some((b) =>
      ['继续', '停止'].includes(b.textContent || '')
    ),
    '任务中心状态未知时不开放中断队列控制'
  )
  await click('关闭')
  f.failStatus = false
  await click('重新检查后台任务')
  await until(() => !button('恢复未完成队列')!.disabled)
  f.failQueue = true
  await useBatchStore
    .getState()
    .refresh()
    .catch(() => {})
  await delay()
  assert(
    button('恢复未完成队列')!.disabled,
    '队列读取失败即使保留旧 interrupted 快照也不开放恢复'
  )
  f.failQueue = false
  await useBatchStore.getState().refresh()
  await until(() => !button('恢复未完成队列')!.disabled)
  await refresh()
  await reachable(
    button('恢复未完成队列')!,
    '390px 中断队列恢复操作可聚焦且可点击'
  )
  await w.testCapture('batch-interrupted-resume-390')
  await click('恢复未完成队列')
  await until(() => f.finishResume)
  assert(
    f.calls.filter((c: any) => c.method === 'resumeBatch').at(-1).args[0] ===
      'interrupted-original-a',
    '真实中断恢复点击定向发送原队列 ID，不使用无参兼容路径'
  )
  assert(button('恢复未完成队列')!.disabled, '中断恢复请求未结算时禁用重复恢复')
  f.finishResume()
  await until(() => text().includes('队列正在运行') || !!button('暂停队列'))
  assert(
    f.queue.cursor === 1 &&
      f.queue.tasks[0].status === 'done' &&
      !button('恢复未完成队列'),
    '恢复快照切换运行态并保留已提交任务与原游标'
  )
  f.queue.status = 'stopped'
  f.queue.updatedAt++
  f.execution = { busy: false, phase: 'idle' }
  await useBatchStore.getState().refresh()
  await refresh()
  await until(() => text().includes('队列已停止'))
  assert(
    !button('恢复未完成队列') && !button('继续执行'),
    '已停止且未完成的真实批量页不再提供不可用的继续或恢复动作'
  )
  await w.testCapture('batch-stopped-no-resume-390')
  await click('任务中心')
  assert(
    ![...interruptedCard().querySelectorAll('button')].some(
      (b) => b.textContent === '继续'
    ),
    '已停止队列在任务中心同样不显示继续动作'
  )
  await w.testCapture('task-center-stopped-no-resume-390')
  await click('关闭')
  assert(
    !f.calls.some((c: any) => c.method.startsWith('FORBIDDEN:')),
    '所有真实页面调用均限于明确受控 API'
  )
  await w.testFinish({ ok: true, checks, calls: f.calls })
}
void main().catch((error) =>
  w.testFinish({
    ok: false,
    error: String(error),
    stack: error.stack,
    checks,
    calls: f.calls
  })
)
