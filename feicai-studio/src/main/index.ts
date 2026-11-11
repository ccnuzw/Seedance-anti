// ============================================================
// Electron 主进程入口
// ============================================================

import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc/register'
import { closeDatabase, initDatabase } from './db/database'
import {
  initializeRuntimeQueue,
  shutdownRuntime
} from './services/pipeline-runtime-service'
import { registerBatchHandlers } from './ipc/batch-handlers'
import { registerDataManagementHandlers } from './ipc/data-management-handlers'
import { setTrustedIpcRendererUrl } from './security/safe-ipc'
import { flushPendingWrites } from './io/atomic-file'
import { shutdownProjectSyncWorker } from './db/episode-sync-worker'

let mainWindow: BrowserWindow | null = null
let quitRequested = false
let quitReady = false
let draining = false

async function drainAndQuit(): Promise<void> {
  if (draining) return
  draining = true
  try {
    await shutdownRuntime()
    await flushPendingWrites()
    await shutdownProjectSyncWorker()
    closeDatabase()
    quitReady = true
    app.quit()
  } catch (error) {
    draining = false
    quitRequested = false
    dialog.showErrorBox(
      '未能安全退出',
      error instanceof Error ? error.message : '数据保存失败，请重试'
    )
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  }
}

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
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      title: '尚有未保存编辑',
      message: '存在未保存修改，仍要退出？',
      detail:
        '本地草稿可能未成功保存，退出可能丢失修改。原文件不会被自动覆盖。',
      buttons: ['继续编辑', '仍然退出'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 1) event.preventDefault()
    else quitRequested = false
  })
  mainWindow.on('closed', () => {
    mainWindow = null
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

  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(join(__dirname, '../renderer/index.html')).href
  setTrustedIpcRendererUrl(rendererUrl)
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target.split('#')[0] !== rendererUrl.split('#')[0])
      event.preventDefault()
  })
  void mainWindow.loadURL(rendererUrl)
}

// 初始化
app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('com.feicai.studio')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 初始化数据库
    initDatabase()

    // 注册所有 IPC handlers
    registerAllHandlers()
    registerBatchHandlers()
    registerDataManagementHandlers()
    await initializeRuntimeQueue()

    // 创建窗口
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    dialog.showErrorBox(
      '启动失败',
      error instanceof Error ? error.message : '应用初始化失败'
    )
    closeDatabase()
    quitReady = true
    app.quit()
  })

app.on('window-all-closed', () => {
  if (quitRequested) void drainAndQuit()
  else if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitReady) return
  event.preventDefault()
  if (quitRequested) return
  quitRequested = true
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) void drainAndQuit()
  else for (const window of windows) window.close()
})

export { mainWindow }
