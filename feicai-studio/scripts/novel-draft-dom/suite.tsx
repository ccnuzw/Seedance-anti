/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  MemoryRouter,
  Routes,
  Route,
  useNavigate,
  useLocation
} from 'react-router-dom'
import Story from '@renderer/pages/StoryBeatEditorPage'
import Source from '@renderer/pages/SourceEditorPage'
import Health from '@renderer/pages/ProjectHealthPage'
import { useProjectStore } from '@renderer/stores/projectStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { resolveEpisodeArtifactPath } from '@shared/path-resolver'
const w = window as any,
  f = w.fixture,
  checks: string[] = []
const project: any = {
  id: 'a',
  name: 'Synthetic',
  projectPath: '/synthetic/a',
  config: { entryStage: 'novel' }
}
f.storyPath = resolveEpisodeArtifactPath(
  project.projectPath,
  'storyBeat',
  4,
  project.config
)
let navigate: any
function Observer() {
  navigate = useNavigate()
  return <output>{useLocation().pathname + useLocation().search}</output>
}
const root = createRoot(document.getElementById('root')!)
useProjectStore.setState({
  currentProject: project,
  episodes: [{ id: 'a-4', episodeNumber: 4, projectId: 'a' } as any]
})
root.render(
  <MemoryRouter initialEntries={['/project/a/story?ep=4']}>
    <Observer />
    <Routes>
      <Route path="/project/:id/story" element={<Story />} />
      <Route path="/project/:id/source" element={<Source />} />
      <Route path="/project/:id/health" element={<Health />} />
      <Route path="*" element={<p>导航目标</p>} />
    </Routes>
  </MemoryRouter>
)
const delay = () => new Promise((r) => setTimeout(r, 40))
function assert(ok: any, message: string) {
  if (!ok) throw new Error(message)
  checks.push(message)
}
async function until(fn: () => any) {
  for (let i = 0; i < 150; i++) {
    if (fn()) return
    await delay()
  }
  throw new Error(document.body.innerText)
}
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) =>
    b.textContent?.startsWith(label)
  )!
async function click(label: string) {
  await until(() => button(label) && !button(label).disabled)
  button(label).click()
  await delay()
}
async function remount() {
  navigate('/empty')
  await delay()
  navigate('/project/a/story?ep=4')
  await until(
    () =>
      button('生成剧情草稿') ||
      button('保存并审核草稿') ||
      button('前往可制作剧本') ||
      button('配置文本模型') ||
      button('生成下一批剧情草稿') ||
      button('核对既有剧本') ||
      button('重新读取草稿与状态') ||
      button('刷新核对集数')
  )
}
try {
  await until(() => button('生成剧情草稿'))
  assert(
    document.body.innerText.includes('第7批'),
    'batch comes from summary, not EP4'
  )
  f.fail = true
  await click('生成剧情草稿')
  await until(() => document.body.innerText.includes('合成零剧情点错误'))
  assert(
    !f.calls.some((c: any) => ['write', 'review'].includes(c.method)),
    'first click only generates, failure does not save/review'
  )
  f.fail = false
  await click('生成剧情草稿')
  await until(() => button('保存并审核草稿'))
  assert(
    document.querySelector('textarea')?.value.includes('feicai-story-batch:7'),
    'generation reloads real artifact'
  )
  assert(
    !f.calls.some((c: any) => c.method === 'review'),
    'successful generation does not auto review'
  )
  f.fail = true
  await click('保存并审核草稿')
  await until(() => document.body.innerText.includes('审核未通过'))
  assert(!button('前往可制作剧本'), 'failed review stays in step')
  f.fail = false
  await click('保存并审核草稿')
  await until(() => button('前往可制作剧本'))
  await click('前往可制作剧本')
  assert(
    document.body.innerText.includes('/script?ep=12'),
    'passed inventory routes to actual ready episode'
  )
  // A real pending draft must win over inventory and remaining chapters.
  f.ready = [12]
  f.used = [12]
  f.status = 'pending'
  await remount()
  assert(
    !!button('保存并审核草稿'),
    'pending draft is reviewed before next generation'
  )
  f.status = 'passed'
  f.batch = 8
  await remount()
  await until(() => button('生成下一批剧情草稿'))
  w.confirm = () => true
  await click('生成下一批剧情草稿')
  await until(() =>
    document.querySelector('textarea')?.value.includes('feicai-story-batch:8')
  )
  assert(
    f.calls.filter((c: any) => c.method === 'generate').at(-1).args[0]
      .batchNumber === 8,
    'consumed passed batch explicitly generates batch8 in same EP slot'
  )
  f.status = 'passed'
  f.batch = 9
  f.remaining = 0
  await remount()
  assert(
    !!button('核对既有剧本') && document.body.innerText.includes('拆解已完成'),
    'exhausted chapters show completion instead of refresh loop'
  )
  f.ready = [12, 13, 14, 15]
  f.used = [12, 13]
  f.episodes = [
    { projectId: 'a', episodeNumber: 14, scriptPath: '/synthetic/script14.md' },
    { projectId: 'a', episodeNumber: 15, hasScript: false }
  ]
  await remount()
  await click('前往可制作剧本')
  assert(
    document.body.innerText.includes('/script?ep=15'),
    'mixed ready used and existing scripts selects only unused missing script'
  )
  f.ready = [12]
  f.used = []
  f.remaining = 6
  for (const [name, fixture] of [
    ['empty', []],
    ['foreign only', [{ projectId: 'b', episodeNumber: 12 }]],
    ['missing target', [{ projectId: 'a', episodeNumber: 4 }]]
  ] as const) {
    f.episodeOverride = fixture
    await remount()
    await until(() => button('刷新核对集数'))
    assert(
      !button('生成下一批剧情草稿') &&
        !button('核对既有剧本') &&
        !button('前往可制作剧本'),
      `${name} inventory requires refresh without advancing`
    )
  }
  f.episodeOverride = [{ projectId: 'a', episodeNumber: 13, hasScript: false }]
  f.ready = [12, 13]
  await remount()
  await click('前往可制作剧本')
  assert(
    document.querySelector('output')?.textContent?.includes('/script?ep=13'),
    'unknown target permits another explicitly known ready episode'
  )
  f.episodeOverride = null
  f.ready = [15]
  f.episodeFail = true
  await remount()
  await until(() => button('重新读取草稿与状态'))
  assert(
    !button('前往可制作剧本'),
    'episode read failure cannot claim missing scripts'
  )
  f.episodeFail = false
  f.status = 'stale'
  f.ready = []
  f.used = []
  f.remaining = 12
  f.batch = 7
  f.episodes = []
  f.files[f.storyPath] = '<!-- feicai-story-batch:7 -->\n测试'
  await remount()
  assert(!!button('保存并审核草稿'), 'stale pass requires review')
  f.files[f.storyPath] = '手写内容'
  await remount()
  w.confirm = () => false
  const before = f.calls.length
  await click('生成剧情草稿')
  assert(
    !f.calls.slice(before).some((c: any) => c.method === 'generate'),
    'manual content requires explicit replacement confirmation'
  )
  const editor = document.querySelector('textarea')!
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!.call(editor, '未保存手写修改')
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  await delay()
  w.confirm = () => true
  await click('生成剧情草稿')
  assert(
    editor.value === '未保存手写修改' &&
      !f.calls.slice(before).some((c: any) => c.method === 'generate'),
    'unsaved manual edits survive confirmed generation attempt'
  )
  await click('保存')
  f.files[f.storyPath] = null
  f.model = false
  await remount()
  await click('配置文本模型')
  assert(
    document.body.innerText.includes('/settings'),
    'missing model has settings entry'
  )
  f.model = true
  await remount()
  usePipelineStore.setState({ isRunning: true })
  await delay()
  assert(
    button('生成剧情草稿').disabled,
    'existing running state blocks duplicate actions'
  )
  usePipelineStore.setState({ isRunning: false })
  let release: any
  f.defer = new Promise((r) => (release = r))
  await click('生成剧情草稿')
  useProjectStore.setState({
    currentProject: { ...project, id: 'b', projectPath: '/synthetic/b' }
  })
  await delay()
  release()
  await delay()
  await delay()
  assert(
    !f.calls.slice(-2).some((c: any) => c.method === 'review'),
    'late generation never auto reviews another project'
  )
  assert(
    !document.querySelector('textarea')?.value.includes('feicai-story-batch:7'),
    'late generation does not reload old artifact into new project'
  )
  f.defer = null
  useProjectStore.setState({ currentProject: project })
  f.files[
    resolveEpisodeArtifactPath(
      project.projectPath,
      'storyBeat',
      1,
      project.config
    )
  ] = null
  f.files['/synthetic/a/source/novel.md'] = '真实合成原文'
  navigate('/project/a/source')
  await until(() => button('前往准备剧情草稿'))
  await click('前往准备剧情草稿')
  assert(
    document.body.innerText.includes('/story'),
    'source enters executable story page'
  )
  navigate('/project/a/health')
  await until(() =>
    document.querySelector('output')?.textContent?.includes('/health')
  )
  await until(() => button('生成剧情草稿'))
  await click('生成剧情草稿')
  assert(
    document.body.innerText.includes('/story'),
    'health enters executable story page'
  )
  navigate('/project/a/source')
  await until(() => button('前往准备剧情草稿'))
  const sourceEditor = document.querySelector('textarea')!
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!.call(sourceEditor, '未保存原文修改')
  sourceEditor.dispatchEvent(new Event('input', { bubbles: true }))
  await until(() => button('保存原文'))
  assert(
    !button('保存原文').disabled,
    'source unsaved content prioritizes save'
  )
  await click('保存原文')
  await until(() => button('前往准备剧情草稿'))
  navigate('/empty')
  await delay()
  f.files['/synthetic/a/source/novel.md'] = null
  navigate('/project/a/source')
  await until(() => button('导入小说原文'))
  assert(
    !button('导入小说原文').disabled,
    'missing source primary action imports instead of disabled save'
  )
  f.source = false
  navigate('/project/a/health')
  await until(() => document.body.innerText.includes('完善小说原文'))
  assert(
    !button('生成剧情草稿'),
    'health missing source does not recommend generation'
  )
  await click('进入项目')
  assert(
    document.querySelector('output')?.textContent?.includes('/source'),
    'health missing source routes to preparation'
  )
  navigate('/empty')
  await delay()
  f.readFail = true
  navigate('/project/a/story?ep=4')
  await until(() => button('重新读取草稿与状态'))
  assert(
    !!document.querySelector('[role="alert"]'),
    'read failures have a retry entry'
  )
  f.readFail = false
  await click('重新读取草稿与状态')
  await until(() => !button('重新读取草稿与状态'))
  navigate('/empty')
  await delay()
  useProjectStore.setState({
    currentProject: { ...project, config: { entryStage: 'story' } }
  })
  navigate('/project/a/story?ep=4')
  await until(() => button('保存并审核草稿'))
  assert(
    !!document.querySelector('textarea'),
    'manual story entry retains editor and review action'
  )
  navigate('/empty')
  await delay()
  useProjectStore.setState({
    currentProject: { ...project, config: { entryStage: 'script' } }
  })
  navigate('/project/a/story?ep=4')
  await until(() => document.body.innerText.includes('从剧本起步'))
  assert(!!button('前往剧本'), 'script entry retains script navigation')
  await w.testFinish({ ok: true, checks })
} catch (error) {
  await w.testFinish({
    ok: false,
    checks,
    error: String(error),
    stack: (error as Error).stack
  })
}
