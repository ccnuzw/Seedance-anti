import type { GenerateOptions } from '@shared/types'
import { LLMRequestError, safeLLMError } from './endpoint-security'

const DEFAULT_TIMEOUT = 90_000
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_EVENT_CHARS = 1024 * 1024

function duration(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(value, 2_147_483_647)
    : DEFAULT_TIMEOUT
}

/** One deadline and AbortController for the entire request, including bounded retry. */
export class RequestScope {
  readonly controller = new AbortController()
  readonly signal: AbortSignal = this.controller.signal
  private totalTimer: NodeJS.Timeout
  private firstTimer: NodeJS.Timeout
  private idleTimer?: NodeJS.Timeout
  private readonly idleMs: number
  private readonly parent?: AbortSignal
  private readonly onParentAbort = () => this.abort('模型请求已取消')

  constructor(options?: GenerateOptions) {
    this.idleMs = duration(options?.idleTimeoutMs)
    this.totalTimer = setTimeout(
      () => this.abort('模型请求总时限已超时'),
      duration(options?.timeoutMs)
    )
    this.firstTimer = setTimeout(
      () => this.abort('模型响应首包超时'),
      duration(options?.firstChunkTimeoutMs)
    )
    this.parent = options?.signal
    this.parent?.addEventListener('abort', this.onParentAbort, { once: true })
    if (this.parent?.aborted) this.onParentAbort()
  }

  private abort(message: string): void {
    if (!this.signal.aborted)
      this.controller.abort(new LLMRequestError(message))
  }

  throwIfAborted(): void {
    if (this.signal.aborted) throw this.signal.reason
  }

  activity(): void {
    this.throwIfAborted()
    clearTimeout(this.firstTimer)
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(
      () => this.abort('模型响应空闲超时'),
      this.idleMs
    )
  }

  async wait<T>(operation: Promise<T>): Promise<T> {
    this.throwIfAborted()
    const { promise: interrupted, reject } = Promise.withResolvers<never>()
    const abort = () => reject(this.signal.reason)
    this.signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await Promise.race([operation, interrupted])
      this.throwIfAborted()
      return result
    } finally {
      this.signal.removeEventListener('abort', abort)
    }
  }

  dispose(): void {
    clearTimeout(this.totalTimer)
    clearTimeout(this.firstTimer)
    clearTimeout(this.idleTimer)
    this.parent?.removeEventListener('abort', this.onParentAbort)
    // Also terminates a request when a consumer returns early from a generator.
    this.abort('模型请求已结束')
  }
}

export async function requestJSON(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown> | undefined,
  scope: RequestScope
): Promise<Response> {
  scope.throwIfAborted()
  return scope.wait(
    fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: scope.signal,
      // Never forward a credential to a redirect target, including same-origin paths.
      redirect: 'error'
    })
  )
}

export async function* responseBytes(
  response: Response,
  scope: RequestScope
): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new LLMRequestError('模型响应体为空')
  const reader = response.body.getReader()
  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  scope.signal.addEventListener('abort', onAbort, { once: true })
  let size = 0
  try {
    while (true) {
      const result = await scope.wait(reader.read())
      if (result.done) break
      size += result.value.byteLength
      if (size > MAX_RESPONSE_BYTES)
        throw new LLMRequestError('模型响应超过允许的大小')
      if (result.value.byteLength) {
        scope.activity()
        yield result.value
      }
    }
    scope.throwIfAborted()
  } finally {
    scope.signal.removeEventListener('abort', onAbort)
    try {
      void reader.cancel().catch(() => {})
    } finally {
      reader.releaseLock()
    }
  }
}

export async function readJSON(
  response: Response,
  scope: RequestScope
): Promise<unknown> {
  let raw = ''
  const decoder = new TextDecoder()
  for await (const bytes of responseBytes(response, scope))
    raw += decoder.decode(bytes, { stream: true })
  raw += decoder.decode()
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new LLMRequestError('无法解析模型 JSON 响应')
  }
}

export function assertResponseOK(response: Response): void {
  if (!response.ok)
    throw new LLMRequestError(`模型服务返回 HTTP ${response.status}`)
}

export function assertNonEmpty(text: string): void {
  if (!text.trim())
    throw new LLMRequestError('模型返回空结果，请检查模型能力或内容限制')
}

export interface SSEEvent {
  event: string
  data: unknown
}

function parseEvent(raw: string): SSEEvent | null {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  const text = data.join('\n')
  if (!text.trim()) return event === 'error' ? { event, data: {} } : null
  if (text.trim() === '[DONE]') return { event: 'done', data: null }
  try {
    return { event, data: JSON.parse(text) as unknown }
  } catch {
    throw new LLMRequestError('模型 SSE 响应格式无效')
  }
}

/** Shared incremental parser: CRLF may straddle chunks; EOF dispatches the last event. */
export async function* modelEvents(
  response: Response,
  scope: RequestScope
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  let mode: 'sse' | 'json' | undefined = response.headers
    .get('content-type')
    ?.includes('text/event-stream')
    ? 'sse'
    : undefined
  for await (const bytes of responseBytes(response, scope)) {
    buffer += decoder.decode(bytes, { stream: true })
    if (!mode) {
      const start = buffer.trimStart()
      if (!start) continue
      if (/^(?:event:|data:|:)/.test(start)) mode = 'sse'
      else if (start.startsWith('{') || start.startsWith('[')) mode = 'json'
      else if (start.length >= 6)
        throw new LLMRequestError('无法识别模型响应格式')
    }
    if (mode === 'sse') {
      let separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
      while (separator) {
        if (separator.index > MAX_EVENT_CHARS)
          throw new LLMRequestError('模型 SSE 单包超过允许的大小')
        const event = parseEvent(buffer.slice(0, separator.index))
        buffer = buffer.slice(separator.index + separator[0].length)
        if (event?.event === 'done') return
        if (event) yield event
        separator = /\r\n\r\n|\n\n|\r\r/.exec(buffer)
      }
      if (buffer.length > MAX_EVENT_CHARS)
        throw new LLMRequestError('模型 SSE 单包超过允许的大小')
    }
  }
  buffer += decoder.decode()
  if (!buffer.trim()) return
  if (mode === 'sse') {
    const event = parseEvent(buffer)
    if (event && event.event !== 'done') yield event
  } else {
    try {
      yield { event: 'json', data: JSON.parse(buffer) as unknown }
    } catch (error) {
      if (error instanceof LLMRequestError) throw error
      throw new LLMRequestError('无法解析模型 JSON 响应')
    }
  }
}

export function providerFailure(error: unknown, scope: RequestScope): Error {
  if (scope.signal.aborted) return scope.signal.reason as Error
  return new LLMRequestError(safeLLMError(error))
}
