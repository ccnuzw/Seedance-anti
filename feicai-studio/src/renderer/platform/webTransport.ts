export type WebTransportMode = 'browser-local' | 'remote-http'

export interface WebTransportConfig {
  mode: WebTransportMode
  baseUrl: string
  invokePath: string
  eventsPath: string
}

const WEB_TRANSPORT_KEY = 'feicai-web-transport-config'

const DEFAULT_WEB_TRANSPORT_CONFIG: WebTransportConfig = {
  mode: 'browser-local',
  baseUrl: '',
  invokePath: '/api/platform/invoke',
  eventsPath: '/api/platform/events'
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizePath(path: string, fallback: string): string {
  const value = (path || fallback).trim()
  if (!value) return fallback
  return value.startsWith('/') ? value : `/${value}`
}

export function normalizeWebTransportConfig(input?: Partial<WebTransportConfig>): WebTransportConfig {
  const merged = { ...DEFAULT_WEB_TRANSPORT_CONFIG, ...(input || {}) }
  return {
    mode: merged.mode === 'remote-http' ? 'remote-http' : 'browser-local',
    baseUrl: merged.baseUrl.trim().replace(/\/+$/, ''),
    invokePath: normalizePath(merged.invokePath, DEFAULT_WEB_TRANSPORT_CONFIG.invokePath),
    eventsPath: normalizePath(merged.eventsPath, DEFAULT_WEB_TRANSPORT_CONFIG.eventsPath)
  }
}

export function getWebTransportConfig(): WebTransportConfig {
  if (typeof window === 'undefined') return DEFAULT_WEB_TRANSPORT_CONFIG
  const raw = window.localStorage.getItem(WEB_TRANSPORT_KEY)
  return normalizeWebTransportConfig(safeParse<Partial<WebTransportConfig>>(raw, DEFAULT_WEB_TRANSPORT_CONFIG))
}

export function saveWebTransportConfig(config: Partial<WebTransportConfig>): WebTransportConfig {
  const next = normalizeWebTransportConfig(config)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(WEB_TRANSPORT_KEY, JSON.stringify(next))
  }
  return next
}

export function resetWebTransportConfig(): WebTransportConfig {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(WEB_TRANSPORT_KEY)
  }
  return { ...DEFAULT_WEB_TRANSPORT_CONFIG }
}

function buildUrl(baseUrl: string, path: string): string {
  if (!baseUrl) {
    return path
  }
  return `${baseUrl}${path}`
}

export async function invokeRemoteChannel(
  config: WebTransportConfig,
  channel: string,
  args: unknown[]
): Promise<unknown> {
  const response = await fetch(buildUrl(config.baseUrl, config.invokePath), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel, args })
  })

  if (!response.ok) {
    throw new Error(`Remote platform HTTP ${response.status}: ${response.statusText}`)
  }

  const payload = await response.json() as { ok?: boolean; result?: unknown; error?: string }
  if (payload.ok === false) {
    throw new Error(payload.error || `Remote platform invoke failed for channel: ${channel}`)
  }
  return payload.result
}

export async function probeWebTransportConfig(config: Partial<WebTransportConfig>): Promise<{ success: boolean; message: string }> {
  const normalized = normalizeWebTransportConfig(config)
  if (normalized.mode !== 'remote-http') {
    return { success: true, message: '当前为浏览器本地模式，无需远程后端。' }
  }
  if (!normalized.baseUrl) {
    return { success: false, message: '请先填写远程后端 Base URL。' }
  }

  try {
    const result = await invokeRemoteChannel(normalized, 'app:getVersion', [])
    return { success: true, message: `远程后端可达，版本：${String(result || 'unknown')}` }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function subscribeRemoteChannel(
  config: WebTransportConfig,
  channel: string,
  callback: (...args: unknown[]) => void
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }

  const params = new URLSearchParams({ channel })
  const source = new EventSource(`${buildUrl(config.baseUrl, config.eventsPath)}?${params.toString()}`)

  source.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as { args?: unknown[] }
      callback(...(payload.args || []))
    } catch {
      callback(event.data)
    }
  }

  source.onerror = () => {
    source.close()
  }

  return () => {
    source.close()
  }
}
