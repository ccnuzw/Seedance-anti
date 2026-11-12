import { app, BrowserWindow, ipcMain, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// This process only loads a temporary copy of the synthetic renderer harness.
const [root, origin] = process.argv.slice(2)
if (!root || !origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error('Temporary root and loopback origin required')
}
for (const name of ['userData', 'sessionData', 'crashDumps', 'logs']) {
  const path = join(root, name)
  await mkdir(path, { recursive: true })
  app.setPath(name, path)
}
app.commandLine.appendSwitch('disable-background-networking')
let window
let finished = false
const timeout = setTimeout(
  () => finish({ ok: false, error: 'DOM suite timed out' }),
  90000
)
async function finish(result) {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  await writeFile(
    join(root, 'result.json'),
    JSON.stringify(
      {
        ...result,
        boundary:
          'synthetic feicaiAPI; real renderer/DOM; no production IPC or model'
      },
      null,
      2
    )
  )
  app.exit(result.ok ? 0 : 1)
}
app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, done) => {
      const allowed =
        details.url.startsWith(`${origin}/`) ||
        details.url.startsWith(`${origin.replace('http:', 'ws:')}/`) ||
        details.url.startsWith('data:') ||
        details.url.startsWith('blob:')
      done({ cancel: !allowed })
    })
    window = new BrowserWindow({
      width: 1360,
      height: 940,
      show: true,
      webPreferences: {
        preload: join(root, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('render-process-gone', (_event, detail) =>
      finish({ ok: false, error: detail.reason })
    )
    ipcMain.handle('capture', async (_event, name) => {
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid capture name')
      await new Promise((resolve) => setTimeout(resolve, 80))
      await writeFile(
        join(root, `${name}.png`),
        (await window.webContents.capturePage()).toPNG()
      )
    })
    ipcMain.handle('keys', (_event, key) => {
      if (key !== 'Tab' && key !== 'Enter')
        throw new Error('Unsupported test key')
      window.focus()
      window.webContents.focus()
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
      window.webContents.sendInputEvent({
        type: 'char',
        keyCode: key === 'Enter' ? '\r' : key
      })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    })
    ipcMain.handle('resize', async (_event, width) => {
      if (width !== 390) throw new Error('Unsupported viewport')
      window.setContentSize(width, 940)
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    ipcMain.handle('finish', async (_event, result) => finish(result))
    await window.loadURL(origin)
  })
  .catch((error) =>
    finish({ ok: false, error: String(error), stack: error.stack })
  )
