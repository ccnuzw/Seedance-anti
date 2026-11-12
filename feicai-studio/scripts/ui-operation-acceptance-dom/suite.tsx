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
  await w.testCapture('project-settings-refresh-warning-390')
  await w.testResize(1360)
  await reachable(button('💾 保存')!, '桌面项目设置保存操作可聚焦且可点击')
  await w.testCapture('project-settings-refresh-warning-desktop')
  for (const close of document.querySelectorAll<HTMLButtonElement>(
    '.toast-close'
  ))
    close.click()
  await until(() => !document.querySelector('.toast-container'))
  assert(true, '保存通知可关闭，解除窄屏底部操作的临时遮挡')
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
  await w.testCapture('source-390')
  await click('前往准备剧情草稿')
  await until(() => router.state.location.pathname.endsWith('/story'))
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
