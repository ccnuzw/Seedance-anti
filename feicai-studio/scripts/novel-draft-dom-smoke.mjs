// Replays the isolated novel draft entry acceptance against this checkout.
// No production preload, API, configuration, database, or model is used.
import { mkdtemp, cp, symlink, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const directory = dirname(fileURLToPath(import.meta.url))
const studio = resolve(directory, '..')
const require = createRequire(import.meta.url)
const temporary = await mkdtemp(join(tmpdir(), 'feicai-novel-draft-dom-'))
let server
let child
let timer
try {
  await cp(join(directory, 'novel-draft-dom'), temporary, { recursive: true })
  await symlink(
    join(studio, 'node_modules'),
    join(temporary, 'node_modules'),
    'dir'
  )
  server = await createServer({
    configFile: false,
    root: temporary,
    cacheDir: join(temporary, 'vite-cache'),
    esbuild: { jsx: 'automatic' },
    optimizeDeps: {
      entries: [join(temporary, 'suite.tsx')],
      include: [
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom/client',
        'react-router-dom',
        'zustand',
        'zustand/react/shallow'
      ]
    },
    resolve: {
      alias: {
        '@renderer': join(studio, 'src/renderer'),
        '@shared': join(studio, 'src/shared'),
        react: join(studio, 'node_modules/react'),
        'react-dom': join(studio, 'node_modules/react-dom')
      }
    },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [temporary, studio] } }
  })
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(
    require('electron'),
    [join(temporary, 'electron.mjs'), temporary, origin],
    { env, stdio: 'inherit' }
  )
  timer = setTimeout(() => child.kill('SIGKILL'), 110000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  const report = await readFile(join(temporary, 'result.json'), 'utf8')
  console.log(report)
  if (process.env.NOVEL_DRAFT_DOM_REPORT)
    await writeFile(process.env.NOVEL_DRAFT_DOM_REPORT, report)
  if (code !== 0 || !JSON.parse(report).ok)
    throw new Error(`Synthetic DOM suite failed (${code})`)
} finally {
  clearTimeout(timer)
  if (child?.exitCode === null) child.kill('SIGKILL')
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
