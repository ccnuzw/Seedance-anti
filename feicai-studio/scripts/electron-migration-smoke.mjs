// Run after npm run build, with the already installed Electron/native modules.
// Never runs install, rebuild, development startup, or a provider request.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const fixture = fileURLToPath(import.meta.url)
const project = resolve(dirname(fixture), '..')

if (!process.versions.electron) {
  const temporary = mkdtempSync(join(tmpdir(), 'feicai-electron-smoke-'))
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    const child = spawnSync(require('electron'), [fixture, temporary], {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: 45000
    })
    process.stdout.write(child.stdout || '')
    process.stderr.write(child.stderr || '')
    assert.ifError(child.error)
    assert.equal(child.status, 0)
    assert.match(child.stdout, /ELECTRON_MIGRATION_SMOKE_OK/)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
} else {
  const { app, dialog, session } = require('electron')
  const Database = require('better-sqlite3')
  const temporary = process.argv[2]
  assert.ok(temporary && temporary.startsWith(tmpdir()))
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = join(temporary, name)
    mkdirSync(directory, { recursive: true })
    app.setPath(name, directory)
  }
  const secondary = process.argv.includes('--secondary')
  const fail = (error) => {
    console.error(error)
    app.exit(1)
  }
  dialog.showErrorBox = (title, message) =>
    fail(new Error(`${title}: ${message}`))
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  const databasePath = join(app.getPath('userData'), 'data', 'feicai.db')
  if (!secondary) {
    mkdirSync(dirname(databasePath), { recursive: true })
    const db = new Database(databasePath)
    // Historical llm_configs intentionally lacks category and later columns.
    // No credentials or projects are inserted, so startup cannot contact a provider.
    db.exec(`CREATE TABLE llm_configs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
      base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, model TEXT NOT NULL,
      max_tokens INTEGER DEFAULT 8192, temperature REAL DEFAULT 0.7,
      is_default BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
    db.close()
    app.whenReady().then(() => {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(file|data|devtools):/.test(details.url) })
      })
    })
    app.once('browser-window-created', (_, window) => {
      window.webContents.once('did-finish-load', async () => {
        try {
          assert.deepEqual(
            await window.webContents.executeJavaScript(
              'window.feicaiAPI.listProjects()'
            ),
            []
          )
          const migrated = new Database(databasePath, { readonly: true })
          assert.equal(migrated.pragma('user_version', { simple: true }), 1)
          assert.equal(
            migrated.pragma('integrity_check', { simple: true }),
            'ok'
          )
          assert.deepEqual(migrated.pragma('foreign_key_check'), [])
          assert.deepEqual(
            migrated
              .pragma("index_info('idx_llm_configs_category_default_name')")
              .map((column) => column.name),
            ['category', 'is_default', 'name']
          )
          migrated.close()
          let notified = false
          app.once('second-instance', () => {
            notified = true
          })
          const child = spawn(
            process.execPath,
            [fixture, temporary, '--secondary'],
            {
              cwd: project,
              stdio: ['ignore', 'pipe', 'pipe']
            }
          )
          let output = ''
          child.stdout.on('data', (data) => {
            output += data
          })
          child.stderr.on('data', (data) => {
            output += data
          })
          child.on('error', fail)
          child.on('exit', (code) => {
            try {
              assert.equal(code, 0, output)
              assert.equal(
                notified,
                true,
                'Primary must receive second-instance'
              )
              assert.ok(!output.includes('UNEXPECTED_SECONDARY_WINDOW'), output)
              console.log(
                `ELECTRON_MIGRATION_SMOKE_OK Electron=${process.versions.electron} Node=${process.versions.node}: legacy migration, renderer/preload IPC, second-instance, graceful quit`
              )
              app.quit()
            } catch (error) {
              fail(error)
            }
          })
        } catch (error) {
          fail(error)
        }
      })
      window.webContents.once('did-fail-load', (_, code, description) =>
        fail(new Error(`${code}: ${description}`))
      )
    })
  } else {
    app.once('browser-window-created', () =>
      fail(new Error('UNEXPECTED_SECONDARY_WINDOW'))
    )
  }
  const timeout = setTimeout(() => fail(new Error('Smoke timed out')), 30000)
  timeout.unref()
  require(join(project, 'out/main/index.js'))
}
