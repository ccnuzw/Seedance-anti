// Run from feicai-studio through ui-operation-acceptance.Makefile.
// m1-verify.py owns dependency links, isolated caches, and tsbuildinfo restoration.
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
const output = resolve(
  process.env.UI_DOM_ARTIFACT_DIR ||
    '/tmp/feicai-ui-operation-acceptance-task-3'
)
mkdirSync(output, { recursive: true })
process.env.UI_DOM_ARTIFACT_DIR = output
const suites = [
  ['production-matrix', 'scripts/m1-dom-smoke.mjs'],
  ['task-center', 'scripts/task-center-dom-smoke.mjs'],
  ['novel-draft', 'scripts/novel-draft-dom-smoke.mjs'],
  ['novel-production', 'scripts/novel-production-dom-smoke.mjs'],
  ['operations', 'scripts/ui-operation-acceptance-smoke.mjs']
]
const formatFiles = [
  'scripts/m1-dom/boot.ts',
  'scripts/m1-dom/suite.tsx',
  'scripts/m1-dom-smoke.mjs',
  'scripts/novel-draft-dom-smoke.mjs',
  'scripts/novel-draft-dom/boot.ts',
  'scripts/novel-draft-dom/suite.tsx',
  'scripts/novel-production-dom-smoke.mjs',
  'scripts/novel-production-dom/suite.tsx',
  'scripts/task-center-dom-smoke.mjs',
  'scripts/task-center-dom/suite.tsx',
  'scripts/ui-operation-acceptance-artifacts.mjs',
  'scripts/ui-operation-acceptance-verify.mjs',
  'scripts/ui-operation-acceptance-smoke.mjs',
  'scripts/ui-operation-acceptance-dom',
  'src/renderer/components/project/ProjectPipelineSettingsPanel.tsx',
  'src/renderer/pages/StoryBeatEditorPage.tsx',
  'src/renderer/pages/BatchPage.tsx',
  'src/renderer/components/layout/AppShell.tsx',
  'src/renderer/components/layout/ToastContainer.tsx',
  'src/renderer/components/layout/ToastContainer.css',
  'src/renderer/stores/batchStore.ts',
  'src/renderer/stores/batchStore.test.ts',
  'docs/ui-operation-acceptance.md'
]
const report = {
  ok: true,
  revision: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8'
  }).stdout.trim(),
  startedAt: new Date().toISOString(),
  boundary:
    'real renderer, ProjectRouteSync and Electron DOM; synthetic feicaiAPI; disposable Electron profiles; no production main/preload/database/models',
  commands: [],
  suites: [],
  assertionCount: 0,
  screenshots: [],
  gallery: join(output, 'gallery.html')
}
function run(name, command, args) {
  console.log(`UI_ACCEPTANCE: ${name}`)
  const log = join(output, `${name}.log`)
  const fd = openSync(log, 'w')
  let result
  try {
    result = spawnSync(command, args, {
      stdio: ['ignore', fd, fd],
      timeout: 180000
    })
  } finally {
    closeSync(fd)
  }
  const ok = result.status === 0 && !result.error
  report.commands.push({
    name,
    command: [command, ...args],
    ok,
    status: result.status,
    error: result.error?.message,
    log
  })
  report.ok &&= ok
  if (!ok) console.error(`Failed: ${name}; inspect ${log}`)
}
for (const [name, script] of suites) {
  // Prevent a failed launch from accidentally reusing an older passing report.
  rmSync(join(output, name), { recursive: true, force: true })
  run(name, process.execPath, [script])
  try {
    const result = JSON.parse(
      readFileSync(join(output, name, 'result.json'), 'utf8')
    )
    report.suites.push({ name, ...result })
    report.assertionCount += result.checks?.length || 0
    report.ok &&= result.ok
    for (const file of readdirSync(join(output, name))) {
      if (file.endsWith('.png'))
        report.screenshots.push(join(output, name, file))
    }
  } catch (error) {
    report.ok = false
    report.suites.push({ name, ok: false, error: String(error) })
  }
}
run('renderer-tests', process.execPath, [
  'node_modules/vitest/vitest.mjs',
  'run',
  'src/renderer'
])
run('typecheck', 'npm', ['run', 'typecheck', '--', '--force'])
run('lint', 'npm', ['run', 'lint'])
run('prettier', process.execPath, [
  'node_modules/prettier/bin/prettier.cjs',
  '--check',
  ...formatFiles
])
run('diff-check', 'git', ['diff', '--check'])
report.finishedAt = new Date().toISOString()
writeFileSync(
  report.gallery,
  `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>界面操作验收截图库</title><style>body{font:16px system-ui;margin:24px;background:#111;color:#eee}a{color:#aaaaff}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}figure{margin:0}img{width:100%;max-height:700px;object-fit:contain;object-position:top;background:#222}figcaption{overflow-wrap:anywhere;margin:8px 0}</style>
<h1>界面操作验收</h1><p>${report.ok ? '通过' : '存在失败'} · ${report.assertionCount} 条 DOM 断言 · ${report.screenshots.length} 张截图 · <a href="report.json">机器可读报告</a></p>
<div class="gallery">${report.screenshots
    .map((path) => {
      const name = relative(output, path)
      const href = encodeURI(name)
      return `<figure><a href="${href}"><img loading="lazy" src="${href}" alt="${name}"></a><figcaption>${name}</figcaption></figure>`
    })
    .join('\n')}</div></html>`
)
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      assertionCount: report.assertionCount,
      screenshots: report.screenshots.length,
      report: join(output, 'report.json')
    },
    null,
    2
  )
)
process.exitCode = report.ok ? 0 : 1
