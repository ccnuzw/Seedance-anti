// ============================================================
// Electron 主进程入口
// ============================================================

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc/register'
import { initDatabase } from './db/database'
import { getPipelineRuntime } from './services/pipeline-runtime-service'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'FEICAI Studio',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const target = new URL(details.url)
      const isLocalDev =
        is.dev && (target.protocol === 'http:' || target.protocol === 'https:')
      if (target.protocol === 'https:' || isLocalDev) {
        shell.openExternal(details.url)
      }
    } catch {
      // ignore malformed URLs
    }
    return { action: 'deny' }
  })

  // 开发环境加载 dev server，生产环境加载打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 初始化
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.feicai.studio')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 初始化数据库
  initDatabase()

  // 注册所有 IPC handlers
  registerAllHandlers()

  // 创建窗口
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 优雅关闭：在退出前中止正在运行的流水线
app.on('before-quit', () => {
  try {
    const pipeline = getPipelineRuntime()
    const state = pipeline.getState()
    const terminalStates = ['idle', 'episode_complete', 'error', 'paused']
    if (!terminalStates.includes(state)) {
      pipeline.abort()
    }
  } catch {
    /* pipeline 未初始化 */
  }
})

export { mainWindow }
