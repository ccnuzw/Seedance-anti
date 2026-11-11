import type { LLMProviderType } from '@shared/types'

/** Only application-authored messages may cross the provider/IPC boundary. */
export class LLMRequestError extends Error {
  constructor(message: string) {
    super(message.slice(0, 240))
    this.name = 'LLMRequestError'
  }
}

export function safeLLMError(error: unknown): string {
  return error instanceof LLMRequestError
    ? error.message
    : '模型请求失败，请检查网络、端点、模型与密钥设置'
}

export function normalizeBaseEndpoint(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl.trim())
  } catch {
    throw new LLMRequestError('API 端点必须是有效的绝对 URL')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LLMRequestError('API 端点不得包含 URL 凭据、查询参数或片段')
  }
  const hostname = url.hostname.toLowerCase()
  const loopback =
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new LLMRequestError('非本机回环 API 端点必须使用 HTTPS')
  }
  return url.toString().replace(/\/+$/, '')
}

export function endpointIdentity(
  provider: LLMProviderType,
  baseUrl: string
): string {
  return `${provider}:${normalizeBaseEndpoint(baseUrl)}`
}

export function openAIBaseEndpoint(baseUrl: string): string {
  const base = normalizeBaseEndpoint(baseUrl)
  return base.endsWith('/v1') ? base : `${base}/v1`
}
