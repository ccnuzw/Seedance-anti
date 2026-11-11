import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

let trustedRendererUrl: string | null = null

function normalizeRendererUrl(value: string): string {
  const url = new URL(value)
  url.hash = '' // HashRouter is application navigation, not a new origin.
  return url.href
}

/** Main-process bootstrap sets the exact packaged file or development entry URL. */
export function setTrustedIpcRendererUrl(url: string): void {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'file:' &&
    !(
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    )
  ) {
    throw new Error('IPC renderer必须为本地应用页面')
  }
  trustedRendererUrl = normalizeRendererUrl(url)
}

export function assertSafeIpcSender(event: IpcMainInvokeEvent): void {
  const frame = event?.senderFrame
  const sender = event?.sender
  if (
    !trustedRendererUrl ||
    !frame ||
    !sender ||
    sender.isDestroyed() ||
    frame !== sender.mainFrame ||
    !BrowserWindow.fromWebContents(sender)
  ) {
    throw new Error('拒绝非本地应用frame的IPC请求')
  }
  try {
    if (
      normalizeRendererUrl(frame.url) !== trustedRendererUrl ||
      normalizeRendererUrl(sender.getURL()) !== trustedRendererUrl
    ) {
      throw new Error('untrusted renderer')
    }
  } catch {
    throw new Error('拒绝非本地应用frame的IPC请求')
  }
}

export function registerSafeIpcHandler(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1]
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertSafeIpcSender(event)
    return listener(event, ...args)
  })
}
