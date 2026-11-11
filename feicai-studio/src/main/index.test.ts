import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: undefined as unknown as EventEmitter & {
    requestSingleInstanceLock: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
    whenReady: ReturnType<typeof vi.fn>
  },
  windows: [] as Array<{
    isMinimized: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn<() => void>>
  }>,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
  initializeRuntimeQueue: vi.fn(),
  shutdownRuntime: vi.fn(),
  flushPendingWrites: vi.fn(),
  shutdownProjectSyncWorker: vi.fn(),
  registerAllHandlers: vi.fn(),
  registerBatchHandlers: vi.fn(),
  registerDataManagementHandlers: vi.fn(),
  showErrorBox: vi.fn()
}))
vi.mock('electron', () => ({
  get app() {
    return mocks.app
  },
  BrowserWindow: class extends EventEmitter {
    static getAllWindows() {
      return mocks.windows
    }
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn()
    })
    isMinimized = vi.fn(() => false)
    restore = vi.fn()
    show = vi.fn()
    focus = vi.fn()
    close = vi.fn(() => {
      mocks.windows.splice(mocks.windows.indexOf(this), 1)
      this.emit('closed')
      if (!mocks.windows.length) mocks.app.emit('window-all-closed')
    })
    loadURL = vi.fn().mockResolvedValue(undefined)
    constructor() {
      super()
      mocks.windows.push(this)
    }
  },
  dialog: { showErrorBox: mocks.showErrorBox },
  shell: { openExternal: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))
vi.mock('./ipc/register', () => ({
  registerAllHandlers: mocks.registerAllHandlers
}))
vi.mock('./ipc/batch-handlers', () => ({
  registerBatchHandlers: mocks.registerBatchHandlers
}))
vi.mock('./ipc/data-management-handlers', () => ({
  registerDataManagementHandlers: mocks.registerDataManagementHandlers
}))
vi.mock('./db/database', () => ({
  initDatabase: mocks.initDatabase,
  closeDatabase: mocks.closeDatabase
}))
vi.mock('./services/pipeline-runtime-service', () => ({
  initializeRuntimeQueue: mocks.initializeRuntimeQueue,
  shutdownRuntime: mocks.shutdownRuntime
}))
vi.mock('./security/safe-ipc', () => ({ setTrustedIpcRendererUrl: vi.fn() }))
vi.mock('./io/atomic-file', () => ({
  flushPendingWrites: mocks.flushPendingWrites
}))
vi.mock('./db/episode-sync-worker', () => ({
  shutdownProjectSyncWorker: mocks.shutdownProjectSyncWorker
}))

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.windows.length = 0
  mocks.app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn(() =>
      mocks.app.emit('before-quit', { preventDefault: vi.fn() })
    )
  })
})

describe('single-instance main process lifecycle', () => {
  it('a rejected instance quits without readiness, DB, IPC, recovery or drain hooks', async () => {
    mocks.app.requestSingleInstanceLock.mockReturnValue(false)
    await import('./index')
    await settle()
    expect(mocks.app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(mocks.app.quit).toHaveBeenCalledOnce()
    expect(mocks.app.whenReady).not.toHaveBeenCalled()
    for (const action of [
      mocks.initDatabase,
      mocks.initializeRuntimeQueue,
      mocks.registerAllHandlers,
      mocks.registerBatchHandlers,
      mocks.registerDataManagementHandlers,
      mocks.shutdownRuntime,
      mocks.flushPendingWrites,
      mocks.shutdownProjectSyncWorker,
      mocks.closeDatabase
    ])
      expect(action).not.toHaveBeenCalled()
    expect(mocks.app.listenerCount('before-quit')).toBe(0)
    expect(mocks.app.listenerCount('second-instance')).toBe(0)
    expect(mocks.windows).toHaveLength(0)
  })

  it('claims ownership before initialization and restores/focuses the existing window', async () => {
    await import('./index')
    await settle()
    expect(
      mocks.app.requestSingleInstanceLock.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.initDatabase.mock.invocationCallOrder[0])
    expect(mocks.initializeRuntimeQueue).toHaveBeenCalledOnce()
    expect(mocks.windows).toHaveLength(1)
    const window = mocks.windows[0]
    window.isMinimized.mockReturnValue(true)
    mocks.app.emit('second-instance')
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(mocks.windows).toHaveLength(1)
    if (process.platform === 'darwin') {
      window.close()
      mocks.app.emit('second-instance')
      expect(mocks.windows).toHaveLength(1)
    }
  })

  it('an early second launch does not open a window before runtime recovery finishes', async () => {
    const recovery = Promise.withResolvers<void>()
    mocks.initializeRuntimeQueue.mockReturnValueOnce(recovery.promise)
    await import('./index')
    mocks.app.emit('second-instance')
    expect(mocks.windows).toHaveLength(0)
    recovery.resolve()
    await settle()
    expect(mocks.windows).toHaveLength(1)
  })

  it('the primary instance still drains before quitting and does not reopen during drain', async () => {
    const draining = Promise.withResolvers<void>()
    mocks.shutdownRuntime.mockReturnValueOnce(draining.promise)
    await import('./index')
    await settle()
    const event = { preventDefault: vi.fn() }
    mocks.app.emit('before-quit', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.shutdownRuntime).toHaveBeenCalledOnce()
    expect(mocks.closeDatabase).not.toHaveBeenCalled()
    mocks.app.emit('second-instance')
    expect(mocks.windows).toHaveLength(0)
    draining.resolve()
    await settle()
    expect(mocks.flushPendingWrites).toHaveBeenCalledOnce()
    expect(mocks.shutdownProjectSyncWorker).toHaveBeenCalledOnce()
    expect(mocks.closeDatabase).toHaveBeenCalledOnce()
    expect(mocks.app.quit).toHaveBeenCalledOnce()
  })
})
