// ============================================================
// Electron 主进程入口
// ============================================================

import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc/register'
import { getPipelineManager } from './ipc/pipeline-handlers'
import { initDatabase } from './db/database'
import { listProjects } from './db/queries'
import { ensureProjectDataCompatibility } from './project/project-data-compat'
import { logRuntimeEvent } from './app/runtime-logging'

// 全局保底：捕获未处理的 Promise 拒绝和异常，防止进程崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[Main] UnhandledRejection:', reason)
  logRuntimeEvent({
    timestamp: new Date().toISOString(),
    level: 'error',
    scope: 'runtime',
    message: `UnhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`
  })
})
process.on('uncaughtException', (error) => {
  console.error('[Main] UncaughtException:', error)
  logRuntimeEvent({
    timestamp: new Date().toISOString(),
    level: 'error',
    scope: 'runtime',
    message: `UncaughtException: ${error.stack || error.message}`
  })
})

// 抑制 Chrome DevTools 内部噪音日志（language-mismatch、Autofill 等）
// --log-level=3 仅显示 FATAL 级别日志，过滤 ERROR/WARNING/INFO
app.commandLine.appendSwitch('log-level', '3')
// 禁用 Autofill 功能，消除 'Autofill.enable' 协议错误
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication')

let mainWindow: BrowserWindow | null = null
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}

function getStartupFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('NODE_MODULE_VERSION')) {
    return [
      'better-sqlite3 原生绑定和当前 Electron 运行时不兼容，数据库无法初始化。',
      '请在项目目录执行 `npm run native:rebuild:electron` 后重新启动。',
      '如果通过 `npm run dev` 启动，更新后的脚本会在启动前自动修复 Electron 侧原生依赖。'
    ].join('\n')
  }

  return error instanceof Error ? error.message : String(error)
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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    logRuntimeEvent({
      timestamp: new Date().toISOString(),
      level: 'info',
      scope: 'startup',
      message: 'main window ready-to-show'
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    logRuntimeEvent({
      timestamp: new Date().toISOString(),
      level: 'error',
      scope: 'runtime',
      message: `renderer did-fail-load code=${code} description=${description} url=${validatedURL}`
    })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logRuntimeEvent({
      timestamp: new Date().toISOString(),
      level: 'error',
      scope: 'runtime',
      message: `renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`
    })
  })

  // 开发环境加载 dev server，生产环境加载打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function runStartupProjectDataPreflight(): Promise<void> {
  const projects = listProjects()
  for (const project of projects) {
    try {
      const report = await ensureProjectDataCompatibility(project.projectPath)
      if (report.summary.migrated > 0 || report.summary.errors > 0) {
        console.log(
          `[Main] ProjectDataPreflight ${project.name}: migrated=${report.summary.migrated} errors=${report.summary.errors}`
        )
      }
    } catch (error) {
      console.error(`[Main] ProjectDataPreflightFailed: ${project.projectPath}`, error)
    }
  }
}

// 初始化
if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.feicai.studio')
    logRuntimeEvent({
      timestamp: new Date().toISOString(),
      level: 'info',
      scope: 'startup',
      message: `app ready version=${app.getVersion()} packaged=${app.isPackaged}`
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 初始化数据库
    try {
      initDatabase()
    } catch (error) {
      console.error('[Main] DatabaseInitFailed:', error)
      logRuntimeEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        scope: 'startup',
        message: `DatabaseInitFailed: ${error instanceof Error ? error.stack || error.message : String(error)}`
      })
      dialog.showErrorBox('FEICAI Studio 启动失败', getStartupFailureMessage(error))
      app.exit(1)
      return
    }

    runStartupProjectDataPreflight().catch((error) => {
      console.error('[Main] ProjectDataPreflightFailed:', error)
      logRuntimeEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        scope: 'startup',
        message: `ProjectDataPreflightFailed: ${error instanceof Error ? error.stack || error.message : String(error)}`
      })
    })

    // 注册所有 IPC handlers
    registerAllHandlers()

    // 创建窗口
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error) => {
    console.error('[Main] AppStartupFailed:', error)
    logRuntimeEvent({
      timestamp: new Date().toISOString(),
      level: 'error',
      scope: 'startup',
      message: `AppStartupFailed: ${error instanceof Error ? error.stack || error.message : String(error)}`
    })
    dialog.showErrorBox('FEICAI Studio 启动失败', getStartupFailureMessage(error))
    app.exit(1)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 优雅关闭：在退出前中止正在运行的流水线
app.on('before-quit', () => {
  logRuntimeEvent({
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'runtime',
    message: 'before-quit'
  })
  try {
    const pipeline = getPipelineManager()
    const state = pipeline.getContext().state
    const terminalStates = ['idle', 'director_done', 'art_done', 'episode_complete', 'error', 'paused']
    if (!terminalStates.includes(state)) {
      void pipeline.abort({ reason: '应用正在退出，任务已停止' })
    }
  } catch { /* pipeline 未初始化 */ }
})

export { mainWindow }
