/// <reference types="vite/client" />

// Preload 暴露的 API
interface FeicaiAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  once: (channel: string, callback: (...args: unknown[]) => void) => void
}

interface Window {
  feicaiAPI: FeicaiAPI
}
