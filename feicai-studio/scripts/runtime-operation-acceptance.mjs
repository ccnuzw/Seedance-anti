// Run after the production build. No provider or real user data is used.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const fixture = fileURLToPath(import.meta.url)
const project = resolve(dirname(fixture), '..')
const report = process.env.RUNTIME_ACCEPTANCE_REPORT
if (!process.versions.electron) {
  const root = realpathSync(mkdtempSync('/tmp/feicai-runtime-ipc-'))
  console.log(`RUNTIME_IPC_FIXTURES=${root}`)
  for (const phase of ['settings', 'restart']) {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    const child = spawnSync(require('electron'), [fixture, root, phase], {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: 60000
    })
    writeFileSync(
      join(root, `${phase}.log`),
      (child.stdout || '') + (child.stderr || '')
    )
    process.stdout.write(child.stdout || '')
    process.stderr.write(child.stderr || '')
    assert.ifError(child.error)
    assert.equal(child.status, 0, `See ${root}/${phase}.log`)
    assert.match(child.stdout, /RUNTIME_OPERATION_IPC_OK/)
    assert.ok(
      JSON.parse(readFileSync(join(root, `${phase}.json`), 'utf8')).checks
        .length > 0
    )
    if (phase === 'settings') {
      const saved = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
      // Offline fault fixture: running becomes interrupted during production startup.
      // Completed work requires no provider/model when explicitly resumed.
      writeFileSync(
        join(root, 'userData/batch-queue.json'),
        JSON.stringify({
          id: 'acceptance-interrupted-queue',
          projectId: saved.id,
          projectPath: saved.projectPath,
          mode: 'preproduction',
          status: 'running',
          cursor: 1,
          tasks: [{ episodeNum: 1, status: 'done', steps: {} }],
          updatedAt: '2026-01-01T00:00:00.000Z'
        })
      )
    }
  }
  if (report) writeFileSync(join(report, 'ipc-fixtures.txt'), `${root}\n`)
} else {
  const { app, dialog, session, net, shell } = require('electron')
  const root = process.argv[2]
  const phase = process.argv[3]
  assert.ok(
    root && realpathSync(root).startsWith('/private/tmp/feicai-runtime-ipc-')
  )
  for (const name of [
    'appData',
    'userData',
    'sessionData',
    'logs',
    'crashDumps'
  ]) {
    const directory = join(root, name)
    mkdirSync(directory, { recursive: true })
    app.setPath(name, directory)
  }
  const checks = []
  const networkAttempts = []
  const fail = (error) => {
    console.error(error)
    app.exit(1)
  }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  dialog.showErrorBox = (title, message) =>
    fail(new Error(`${title}: ${message}`))
  const block = (...args) => {
    networkAttempts.push(String(args[0]))
    throw new Error('Acceptance forbids all network/provider calls')
  }
  globalThis.fetch = block
  net.fetch = block
  net.request = block
  shell.openExternal = block
  for (const protocol of ['node:http', 'node:https']) {
    const module = require(protocol)
    module.request = block
    module.get = block
  }
  app.whenReady().then(() =>
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = /^(file|data|devtools):/.test(details.url)
      if (!allowed) networkAttempts.push(details.url)
      callback({ cancel: !allowed })
    })
  )
  const check = (name, action) => {
    action()
    checks.push(name)
    console.log(`PASS ${phase}: ${name}`)
  }
  const hash = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex')
  const snapshot = (path) => {
    if (!existsSync(path)) return null
    const stat = statSync(path, { bigint: true })
    if (stat.isDirectory())
      return Object.fromEntries(
        readdirSync(path)
          .sort()
          .map((name) => [name, snapshot(join(path, name))])
      )
    return { sha256: hash(path), mtimeNs: String(stat.mtimeNs) }
  }
  const timeout = setTimeout(
    () => fail(new Error('IPC acceptance timed out')),
    45000
  )
  timeout.unref()
  app.once('browser-window-created', (_, window) => {
    window.webContents.once('did-fail-load', (_, code, description) =>
      fail(new Error(`${code}: ${description}`))
    )
    window.webContents.once('did-finish-load', async () => {
      try {
        const api = (method, ...args) =>
          window.webContents.executeJavaScript(
            `window.feicaiAPI[${JSON.stringify(method)}](...${JSON.stringify(args)})`
          )
        const Database = require('better-sqlite3')
        const db = new Database(join(root, 'userData/data/feicai.db'), {
          readonly: true
        })
        const databaseState = () => ({
          projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
          episodes: db.prepare('SELECT * FROM episodes ORDER BY id').all(),
          configs: db.prepare('SELECT * FROM llm_configs ORDER BY id').all()
        })
        check('native SQLite integrity and no model credentials', () => {
          assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
          assert.deepEqual(db.pragma('foreign_key_check'), [])
          assert.equal(databaseState().configs.length, 0)
        })
        assert.deepEqual(await api('getExecutionStatus'), {
          busy: false,
          phase: 'idle'
        })
        let saved
        if (phase === 'settings') {
          assert.deepEqual(await api('listProjects'), [])
          const projectPath = join(root, 'project')
          mkdirSync(projectPath)
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [projectPath]
          })
          assert.equal(await api('selectDirectory'), projectPath)
          saved = await api('createProject', {
            name: 'IPC 设置前',
            visualStyle: '写实',
            targetMedium: '短剧',
            totalEpisodes: 2,
            projectPath,
            config: { entryStage: 'novel', chaptersPerEpisode: 3 }
          })
          const configPath = join(projectPath, 'project-config.json')
          const plotPath = join(projectPath, 'story/plot-breakdown.md')
          check(
            'project creation uses production IPC, disk, SQLite and sync worker',
            () => {
              assert.equal(saved.projectPath, projectPath)
              assert.equal(databaseState().projects.length, 1)
              assert.equal(databaseState().episodes.length, 2)
              assert.ok(existsSync(plotPath))
            }
          )
          const originalPlot = readFileSync(plotPath, 'utf8')
          saved = await api('saveProjectSettings', saved.id, {
            name: 'IPC 设置后',
            totalEpisodes: 4,
            config: {
              chaptersPerEpisode: 5,
              directories: { assetsDir: 'acceptance-assets' },
              pipelineSettings: { maxRetries: 2 }
            }
          })
          const diskConfig = JSON.parse(readFileSync(configPath, 'utf8'))
          const row = databaseState().projects[0]
          check('idle settings save agrees with SQLite projection', () => {
            assert.deepEqual(saved.config, diskConfig)
            assert.deepEqual(JSON.parse(row.config_json), diskConfig)
            assert.equal(row.name, 'IPC 设置后')
            assert.equal(row.total_episodes, 4)
            assert.equal(row.updated_at, saved.updatedAt)
            assert.equal(diskConfig.chaptersPerEpisode, 5)
            assert.equal(diskConfig.pipelineSettings.maxRetries, 2)
            assert.ok(existsSync(join(projectPath, 'acceptance-assets')))
          })
          const plot = readFileSync(plotPath, 'utf8')
          check('existing plot planning is updated by settings save', () => {
            assert.notEqual(plot, originalPlot)
            assert.match(plot, /IPC 设置后/)
            assert.match(plot, /- \*\*范围\*\*：第1-20章/)
            assert.match(plot, /- \*\*目标集数\*\*：4 集/)
            assert.match(plot, /- \*\*章节-集数分配原则\*\*：5章\/集/)
            for (const field of ['范围', '目标集数', '章节-集数分配原则'])
              assert.equal(plot.split(`- **${field}**：`).length, 2)
          })
          const operations = join(projectPath, 'outputs/production/operations')
          const journal = readdirSync(operations)
            .filter((name) => name.endsWith('.json'))
            .map((name) =>
              JSON.parse(readFileSync(join(operations, name), 'utf8'))
            )
          check(
            'settings journal contains both files and committed projection receipt',
            () => {
              assert.equal(journal.length, 1)
              assert.equal(journal[0].kind, 'project-settings')
              assert.equal(journal[0].phase, 'committed')
              assert.equal(journal[0].projected, true)
              assert.deepEqual(
                journal[0].files.map((file) => file.path).sort(),
                ['project-config.json', 'story/plot-breakdown.md']
              )
            }
          )
          for (const totalEpisodes of [6, 4, 4]) {
            saved = await api('saveProjectSettings', saved.id, {
              totalEpisodes,
              config: { chaptersPerEpisode: 5 }
            })
            const summary = await api('getPlotBreakdownSummary', saved.id)
            assert.equal(summary.targetChapterLimit, totalEpisodes * 5)
            const currentPlot = readFileSync(plotPath, 'utf8')
            assert.ok(
              currentPlot.includes(`- **目标集数**：${totalEpisodes} 集`)
            )
            for (const field of ['范围', '目标集数', '章节-集数分配原则'])
              assert.equal(currentPlot.split(`- **${field}**：`).length, 2)
          }
          check(
            'repeated settings saves preserve unique planning metadata and public waterline',
            () => {
              assert.equal(readFileSync(plotPath, 'utf8'), plot)
              assert.deepEqual(
                JSON.parse(readFileSync(configPath, 'utf8')),
                saved.config
              )
              assert.deepEqual(
                JSON.parse(databaseState().projects[0].config_json),
                saved.config
              )
            }
          )
          const files = snapshot(projectPath)
          const rows = databaseState()
          const queue = snapshot(join(root, 'userData/batch-queue.json'))
          for (let i = 0; i < 5; i++)
            assert.deepEqual(await api('getExecutionStatus'), {
              busy: false,
              phase: 'idle'
            })
          check(
            'idle status reads preserve project, journal, queue and SQLite rows',
            () => {
              assert.deepEqual(snapshot(projectPath), files)
              assert.deepEqual(databaseState(), rows)
              assert.deepEqual(
                snapshot(join(root, 'userData/batch-queue.json')),
                queue
              )
            }
          )
          const entered = Promise.withResolvers()
          const resume = Promise.withResolvers()
          dialog.showOpenDialog = () => {
            entered.resolve()
            return resume.promise
          }
          const backup = api('backupProject', saved.id)
          await entered.promise
          try {
            for (let i = 0; i < 3; i++)
              assert.deepEqual(await api('getExecutionStatus'), {
                busy: true,
                phase: 'running',
                owner: 'data'
              })
            await assert.rejects(
              api('saveProjectSettings', saved.id, {
                name: '不得写入',
                totalEpisodes: 7,
                config: { chaptersPerEpisode: 9 }
              }),
              /请等待/
            )
            check(
              'busy settings IPC rejects before any file or projection changes',
              () => {
                assert.deepEqual(snapshot(projectPath), files)
                assert.deepEqual(databaseState(), rows)
                assert.deepEqual(
                  snapshot(join(root, 'userData/batch-queue.json')),
                  queue
                )
              }
            )
          } finally {
            resume.resolve({ canceled: true, filePaths: [] })
          }
          assert.equal((await backup).canceled, true)
          assert.deepEqual(await api('getExecutionStatus'), {
            busy: false,
            phase: 'idle'
          })
          for (const method of ['pauseBatch', 'resumeBatch', 'stopBatch']) {
            await assert.rejects(api(method, 'unknown-queue'), /目标已失效/)
            await assert.rejects(api(method, ''), /无效队列标识/)
          }
          check(
            'unknown and malformed queue controls cannot create or affect work',
            () => {
              assert.deepEqual(snapshot(projectPath), files)
              assert.deepEqual(databaseState(), rows)
              assert.equal(
                snapshot(join(root, 'userData/batch-queue.json')),
                null
              )
            }
          )
          writeFileSync(
            join(root, 'project.json'),
            JSON.stringify(saved, null, 2)
          )
        } else {
          saved = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
          assert.deepEqual(await api('getProject', saved.id), saved)
          const queue = await api('getBatchState')
          check(
            'production startup converts running durable fixture to interrupted',
            () => {
              assert.equal(queue.id, 'acceptance-interrupted-queue')
              assert.equal(queue.status, 'interrupted')
              assert.equal(queue.cursor, 1)
            }
          )
          const queuePath = join(root, 'userData/batch-queue.json')
          const files = snapshot(saved.projectPath)
          const rows = databaseState()
          const before = snapshot(queuePath)
          for (const method of ['pauseBatch', 'resumeBatch', 'stopBatch'])
            await assert.rejects(api(method, 'other-queue'), /目标已失效/)
          check(
            'stale identities preserve interrupted durable queue and project',
            () => {
              assert.deepEqual(snapshot(queuePath), before)
              assert.deepEqual(snapshot(saved.projectPath), files)
              assert.deepEqual(databaseState(), rows)
            }
          )
          const entered = Promise.withResolvers()
          const resume = Promise.withResolvers()
          dialog.showOpenDialog = () => {
            entered.resolve()
            return resume.promise
          }
          const backup = api('backupProject', saved.id)
          await entered.promise
          try {
            await assert.rejects(api('resumeBatch', queue.id), /请等待/)
            check(
              'another real IPC lease rejects resume without modifying queue',
              () => assert.deepEqual(snapshot(queuePath), before)
            )
          } finally {
            resume.resolve({ canceled: true, filePaths: [] })
          }
          await backup
          const resumed = await api('resumeBatch', queue.id)
          check('correct interrupted identity resumes under admission', () =>
            assert.equal(resumed.id, queue.id)
          )
          let completed
          for (let i = 0; i < 100; i++) {
            completed = await api('getBatchState')
            if (
              completed.status === 'completed' &&
              !(await api('getExecutionStatus')).busy
            )
              break
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          check(
            'recovered completed work remains without model execution',
            () => {
              assert.equal(completed.status, 'completed')
              assert.equal(completed.cursor, 1)
              assert.deepEqual(completed.tasks, queue.tasks)
              assert.deepEqual(snapshot(saved.projectPath), files)
              assert.deepEqual(databaseState(), rows)
            }
          )
          for (const method of ['pauseBatch', 'resumeBatch', 'stopBatch'])
            await assert.rejects(api(method, queue.id), /目标已失效/)
          assert.deepEqual(await api('getExecutionStatus'), {
            busy: false,
            phase: 'idle'
          })
          check('finished queue rejects all directed controls', () =>
            assert.equal(completed.status, 'completed')
          )
        }
        check('no network or provider request attempted', () =>
          assert.deepEqual(networkAttempts, [])
        )
        db.close()
        const evidence = {
          phase,
          checks,
          networkAttempts,
          electron: process.versions.electron,
          node: process.versions.node,
          modules: process.versions.modules,
          root,
          buildHashes: Object.fromEntries(
            ['main/index.js', 'preload/index.js', 'renderer/index.html'].map(
              (path) => [path, hash(join(project, 'out', path))]
            )
          ),
          boundary:
            'Real production main/preload/IPC/native SQLite; native directory dialogs automated; restart queue seeded offline; no model execution or full UI interaction.'
        }
        writeFileSync(
          join(root, `${phase}.json`),
          JSON.stringify(evidence, null, 2)
        )
        if (report)
          writeFileSync(
            join(report, `ipc-${phase}.json`),
            JSON.stringify(evidence, null, 2)
          )
        console.log(`RUNTIME_OPERATION_IPC_OK ${phase} checks=${checks.length}`)
        app.quit()
      } catch (error) {
        fail(error)
      }
    })
  })
  require(join(project, 'out/main/index.js'))
}
