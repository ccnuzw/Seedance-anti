// ============================================================
// Electron Preload — 安全桥接 IPC
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import type { IPC } from '@shared/ipc-channels'

type IPCChannelValue = string

// 暴露安全的 API 给渲染进程
const api = {
  /** 调用主进程（请求-响应模式） */
  invoke: (channel: IPCChannelValue, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },

  /** 监听主进程推送的事件 */
  on: (channel: IPCChannelValue, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },

  /** 一次性监听 */
  once: (channel: IPCChannelValue, callback: (...args: unknown[]) => void) => {
    ipcRenderer.once(channel, (_event, ...args) => callback(...args))
  }
}

contextBridge.exposeInMainWorld('feicaiAPI', api)

// 类型声明
export type FeicaiAPI = typeof api
