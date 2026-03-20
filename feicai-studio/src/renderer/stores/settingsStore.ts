// ============================================================
// Settings Store — 应用设置状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import { IPC } from '@shared/ipc-channels'
import type { LLMConfig, LLMProviderType, ModelCategory } from '@shared/types'

// ==================== 外观设置 ====================

export type ThemeMode = 'dark' | 'light' | 'system'
export type ZoomLevel = '80' | '90' | '100' | '110' | '120'
export type SidebarWidth = 'compact' | 'standard' | 'wide'

export interface AppSettings {
  theme: ThemeMode
  zoom: ZoomLevel
  sidebarWidth: SidebarWidth
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  zoom: '100',
  sidebarWidth: 'standard'
}

function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('feicai-app-settings')
    if (raw) return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) }
  } catch { /* */ }
  return { ...DEFAULT_APP_SETTINGS }
}

function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem('feicai-app-settings', JSON.stringify(settings))
}

/** 将主题/缩放应用到 DOM */
function applyAppSettings(settings: AppSettings): void {
  const root = document.documentElement

  // 主题
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const effectiveTheme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme
  root.setAttribute('data-theme', effectiveTheme)

  // 缩放
  root.style.fontSize = `${parseInt(settings.zoom) / 100 * 14}px`

  // 侧边栏宽度
  const widthMap: Record<SidebarWidth, string> = { compact: '180px', standard: '220px', wide: '280px' }
  root.style.setProperty('--sidebar-width', widthMap[settings.sidebarWidth])
}

// ==================== Store ====================

interface SettingsStore {
  llmConfigs: LLMConfig[]
  loading: boolean
  appSettings: AppSettings

  loadLLMConfigs: () => Promise<void>
  addLLMConfig: (data: Omit<LLMConfig, 'id'>) => Promise<LLMConfig>
  updateLLMConfig: (id: string, data: Partial<Omit<LLMConfig, 'id'>>) => Promise<void>
  deleteLLMConfig: (id: string) => Promise<void>
  setDefaultLLM: (id: string) => Promise<void>
  testConnection: (config: LLMConfig) => Promise<{ success: boolean; message: string }>
  getDefaultConfig: (category: ModelCategory) => LLMConfig | undefined

  updateAppSettings: (patch: Partial<AppSettings>) => void
  resetAppSettings: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  // 启动时加载并应用
  const initial = loadAppSettings()
  setTimeout(() => applyAppSettings(initial), 0)

  return {
    llmConfigs: [],
    loading: false,
    appSettings: initial,

    loadLLMConfigs: async () => {
      set({ loading: true })
      try {
        const raw = await window.feicaiAPI.invoke(IPC.LLM_LIST_CONFIGS) as LLMConfig[]
        // 兜底：旧数据可能没有 category 字段
        const configs = raw.map(c => ({ ...c, category: c.category || 'llm' as ModelCategory }))
        set({ llmConfigs: configs, loading: false })
      } catch {
        set({ loading: false })
      }
    },

    addLLMConfig: async (data) => {
      const config = await window.feicaiAPI.invoke(IPC.LLM_ADD_CONFIG, data) as LLMConfig
      await get().loadLLMConfigs()
      return config
    },

    deleteLLMConfig: async (id) => {
      await window.feicaiAPI.invoke(IPC.LLM_DELETE_CONFIG, id)
      await get().loadLLMConfigs()
    },

    updateLLMConfig: async (id: string, data: Partial<Omit<LLMConfig, 'id'>>) => {
      await window.feicaiAPI.invoke(IPC.LLM_UPDATE_CONFIG, id, data)
      await get().loadLLMConfigs()
    },

    setDefaultLLM: async (id) => {
      await window.feicaiAPI.invoke(IPC.LLM_SET_DEFAULT, id)
      await get().loadLLMConfigs()
    },

    testConnection: async (config) => {
      return await window.feicaiAPI.invoke(IPC.LLM_TEST_CONNECTION, config) as {
        success: boolean
        message: string
      }
    },

    updateAppSettings: (patch) => {
      const merged = { ...get().appSettings, ...patch }
      saveAppSettings(merged)
      applyAppSettings(merged)
      set({ appSettings: merged })
    },

    getDefaultConfig: (category) => {
      const configs = get().llmConfigs.filter(c => (c.category || 'llm') === category)
      return configs.find(c => c.isDefault) || configs[0]
    },

    resetAppSettings: () => {
      saveAppSettings(DEFAULT_APP_SETTINGS)
      applyAppSettings(DEFAULT_APP_SETTINGS)
      set({ appSettings: { ...DEFAULT_APP_SETTINGS } })
    }
  }
})

