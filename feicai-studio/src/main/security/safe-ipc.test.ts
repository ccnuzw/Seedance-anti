import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

const electron = vi.hoisted(() => ({ fromWebContents: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  ipcMain: { handle: vi.fn() }
}))
import { assertSafeIpcSender, setTrustedIpcRendererUrl } from './safe-ipc'

function event(url: string, subframe = false): IpcMainInvokeEvent {
  const mainFrame = { url }
  // The Electron structures are native objects; this test supplies only the
  // fields consumed by the sender contract, not an untrusted production cast.
  return {
    senderFrame: subframe ? { url } : mainFrame,
    sender: { mainFrame, getURL: () => url, isDestroyed: () => false }
  } as unknown as IpcMainInvokeEvent
}

beforeEach(() => {
  electron.fromWebContents.mockReturnValue({ id: 1 })
  setTrustedIpcRendererUrl('file:///app/renderer/index.html')
})

describe('trusted IPC sender', () => {
  it('只接受精确本地应用主frame，hash路由不改变信任', () => {
    expect(() =>
      assertSafeIpcSender(event('file:///app/renderer/index.html#/project/1'))
    ).not.toThrow()
    expect(() =>
      assertSafeIpcSender(event('https://evil.example/index.html'))
    ).toThrow('frame')
    expect(() =>
      assertSafeIpcSender(event('file:///app/renderer/other.html'))
    ).toThrow('frame')
    expect(() =>
      assertSafeIpcSender(event('file:///app/renderer/index.html', true))
    ).toThrow('frame')
  })

  it('不接受孤立webContents或缺失frame，也不能将远端页面设为本地入口', () => {
    electron.fromWebContents.mockReturnValue(null)
    expect(() =>
      assertSafeIpcSender(event('file:///app/renderer/index.html'))
    ).toThrow('frame')
    expect(() => assertSafeIpcSender({} as IpcMainInvokeEvent)).toThrow('frame')
    expect(() => setTrustedIpcRendererUrl('https://example.com')).toThrow(
      '本地应用'
    )
  })

  it('开发服务必须精确匹配loopback入口，不能只匹配origin', () => {
    setTrustedIpcRendererUrl('http://localhost:5173/')
    expect(() =>
      assertSafeIpcSender(event('http://localhost:5173/#/project'))
    ).not.toThrow()
    expect(() =>
      assertSafeIpcSender(event('http://localhost:5173/remote.html'))
    ).toThrow('frame')
    expect(() => assertSafeIpcSender(event('http://localhost:9999/'))).toThrow(
      'frame'
    )
  })
})
