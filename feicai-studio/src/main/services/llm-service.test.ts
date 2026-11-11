import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@shared/types'
import { LLMRequestError } from '../llm/endpoint-security'
import * as service from './llm-service'

const {
  addLLMConfigRecord,
  deleteLLMConfigRecord,
  listLLMConfigRecords,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfigRecord,
  createProvider,
  fetchMock
} = vi.hoisted(() => ({
  addLLMConfigRecord: vi.fn(),
  deleteLLMConfigRecord: vi.fn(),
  listLLMConfigRecords: vi.fn(),
  resolveLLMConfigForExecution: vi.fn(),
  setDefaultLLMConfig: vi.fn(),
  updateLLMConfigRecord: vi.fn(),
  createProvider: vi.fn(),
  fetchMock: vi.fn()
}))

vi.mock('../db/queries', () => ({
  addLLMConfig: addLLMConfigRecord,
  deleteLLMConfig: deleteLLMConfigRecord,
  listLLMConfigs: listLLMConfigRecords,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfig: updateLLMConfigRecord
}))
vi.mock('../llm/provider-factory', () => ({ createProvider }))

const baseConfig: LLMConfig = {
  id: 'cfg-1',
  name: '测试模型',
  category: 'llm',
  provider: 'openai-compatible',
  baseUrl: 'https://example.com',
  apiKey: '',
  model: 'gpt-test',
  maxTokens: 4096,
  temperature: 0.7,
  isDefault: false
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('llm-service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    listLLMConfigRecords.mockReturnValue([baseConfig])
    resolveLLMConfigForExecution.mockImplementation((value: LLMConfig) => ({
      ...value,
      apiKey: 'stored-key'
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('测试连接使用绑定端点后的配置', async () => {
    createProvider.mockReturnValue({
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: '连接成功',
        model: 'gpt-test'
      })
    })
    expect(await service.testLLMConnection(baseConfig)).toMatchObject({
      success: true
    })
    expect(createProvider).toHaveBeenCalledWith({
      ...baseConfig,
      apiKey: 'stored-key'
    })
  })

  it('列表使用新输入密钥且不解析保存凭据', async () => {
    fetchMock.mockResolvedValue(
      json({
        data: [{ id: 'gpt-4.1', display_name: 'GPT 4.1', owned_by: 'openai' }]
      })
    )
    expect(
      await service.listLLMModels({
        baseUrl: 'https://example.com/',
        apiKey: 'direct-key'
      })
    ).toEqual({
      success: true,
      models: [{ id: 'gpt-4.1', name: 'GPT 4.1', owner: 'openai' }],
      message: '获取到 1 个模型'
    })
    expect(resolveLLMConfigForExecution).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer direct-key' },
        redirect: 'error',
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('保存凭据解析包含请求 provider 与原始 path，不能跨端点拿 key', async () => {
    resolveLLMConfigForExecution.mockImplementation((value: LLMConfig) => {
      if (
        value.provider !== baseConfig.provider ||
        value.baseUrl !== baseConfig.baseUrl
      )
        throw new LLMRequestError(
          'Provider 或 API 端点已变更，请重新输入 API Key'
        )
      return { ...value, apiKey: 'stored-key' }
    })
    expect(
      (
        await service.listLLMModels({
          configId: 'cfg-1',
          baseUrl: 'https://other.example',
          provider: 'openai-compatible'
        })
      ).success
    ).toBe(false)
    expect(
      (
        await service.listLLMModels({
          configId: 'cfg-1',
          baseUrl: baseConfig.baseUrl,
          provider: 'openai'
        })
      ).success
    ).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue(json({ data: [] }))
    expect(
      (
        await service.listLLMModels({
          configId: 'cfg-1',
          baseUrl: baseConfig.baseUrl,
          provider: baseConfig.provider
        })
      ).success
    ).toBe(true)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer stored-key'
    )
  })

  it.each(['http://remote.example/v1', 'https://secret-key@remote.example/v1'])(
    '拒绝不安全列表端点: %s',
    async (baseUrl) => {
      expect(
        (await service.listLLMModels({ baseUrl, apiKey: 'secret-key' })).success
      ).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(resolveLLMConfigForExecution).not.toHaveBeenCalled()
    }
  )

  it('Gemini 与 Anthropic 列表使用对应认证头而非 OpenAI 语义', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ models: [{ name: 'models/gemini-test', displayName: 'Gemini' }] })
    )
    const google = await service.listLLMModels({
      baseUrl: 'https://example.com/proxy',
      apiKey: 'direct',
      provider: 'google'
    })
    expect(google.models).toEqual([
      { id: 'gemini-test', name: 'Gemini', owner: 'Google' }
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://example.com/proxy/v1beta/models'
    )
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'x-goog-api-key': 'direct'
    })
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: 'claude-test' }] }))
    await service.listLLMModels({
      baseUrl: 'https://example.com',
      apiKey: 'direct',
      provider: 'anthropic'
    })
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/v1/models')
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      'x-api-key': 'direct',
      'anthropic-version': '2023-06-01'
    })
  })

  it('模型列表网络超时真正 abort fetch', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      signal = init.signal as AbortSignal
      const { promise, reject } = Promise.withResolvers<Response>()
      signal.addEventListener(
        'abort',
        () => reject(new Error('private-key private-body')),
        { once: true }
      )
      return promise
    })
    const pending = service.listLLMModels({
      baseUrl: 'https://example.com',
      apiKey: 'private-key'
    })
    await vi.advanceTimersByTimeAsync(90_001)
    const result = await pending
    expect(result.success).toBe(false)
    expect(signal.aborted).toBe(true)
    expect(result.message).not.toMatch(/private-key|private-body/)
  })

  it('网络错误与服务端正文不回显密钥或请求内容', async () => {
    fetchMock.mockResolvedValue(
      json({ error: 'private-key private-body'.repeat(1000) }, 500)
    )
    const list = await service.listLLMModels({
      baseUrl: 'https://example.com',
      apiKey: 'private-key'
    })
    createProvider.mockImplementation(() => {
      throw new Error('private-key private-body'.repeat(1000))
    })
    const connection = await service.testLLMConnection(baseConfig)
    for (const result of [list, connection]) {
      expect(result.message).not.toMatch(/private-key|private-body/)
      expect(result.message.length).toBeLessThanOrEqual(240)
    }
  })
})
