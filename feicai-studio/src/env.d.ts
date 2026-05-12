/// <reference types="vite/client" />
import type { FeicaiAPI } from '@shared/ipc-contracts'
import type { RenderProfilerAPI } from '@renderer/dev/render-profiler'

declare global {
  interface Window {
    feicaiAPI: FeicaiAPI
    __FEICAI_RENDER_PROFILER__?: RenderProfilerAPI
  }
}

export {}
