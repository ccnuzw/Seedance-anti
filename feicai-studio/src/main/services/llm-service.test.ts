import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@shared/types'

const addLLMConfigRecord = vi.fn()
const deleteLLMConfigRecord = vi.fn()
const listLLMConfigRecords = vi.fn()
const resolveLLMConfigForExecution = vi.fn()
const setDefaultLLMConfig = vi.fn()
const updateLLMConfigRecord = vi.fn()
const createProvider = vi.fn()
const fetchMock = vi.fn()

vi.mock('../db/queries', () => ({
  addLLMConfig: addLLMConfigRecord,
  deleteLLMConfig: deleteLLMConfigRecord,
  listLLMConfigs: listLLMConfigRecords,
  resolveLLMConfigForExecution,
  setDefaultLLMConfig,
  updateLLMConfig: updateLLMConfigRecord
}))

vi.mock('../llm/provider-factory', () => ({
  createProvider
}))

describe('llm-service', async () => {
  const service = await import('./llm-service')

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

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('测试连接时会使用解析后的配置创建 provider', async () => {
    resolveLLMConfigForExecution.mockReturnValue({
      ...baseConfig,
      apiKey: 'resolved-key'
    })
    createProvider.mockReturnValue({
      testConnection: vi.fn().mockResolvedValue({
        success: true,
        message: '连接成功',
        model: 'gpt-test'
      })
    })

    const result = await service.testLLMConnection(baseConfig)

    expect(resolveLLMConfigForExecution).toHaveBeenCalledWith(baseConfig)
    expect(createProvider).toHaveBeenCalledWith({
      ...baseConfig,
      apiKey: 'resolved-key'
    })
    expect(result).toEqual({
      success: true,
      message: '连接成功',
      model: 'gpt-test'
    })
  })

  it('列出模型时会优先使用 payload 中的 API Key 并补齐 /v1/models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'gpt-4.1', display_name: 'GPT 4.1', owned_by: 'openai' }]
      })
    })

    const result = await service.listLLMModels({
      baseUrl: 'https://example.com/',
      apiKey: 'direct-key'
    })

    expect(resolveLLMConfigForExecution).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', {
      headers: { Authorization: 'Bearer direct-key' }
    })
    expect(result).toEqual({
      success: true,
      models: [{ id: 'gpt-4.1', name: 'GPT 4.1', owner: 'openai' }],
      message: '获取到 1 个模型'
    })
  })

  it('列出模型时会在缺少直接 API Key 时回退到已保存配置', async () => {
    resolveLLMConfigForExecution.mockReturnValue({
      ...baseConfig,
      apiKey: 'stored-key'
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] })
    })

    const result = await service.listLLMModels({
      baseUrl: 'https://example.com/v1',
      configId: 'cfg-1'
    })

    expect(resolveLLMConfigForExecution).toHaveBeenCalledWith({
      id: 'cfg-1',
      name: '',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      model: '',
      maxTokens: 8192,
      temperature: 0.7,
      isDefault: false
    })
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/models', {
      headers: { Authorization: 'Bearer stored-key' }
    })
    expect(result).toEqual({
      success: true,
      models: [],
      message: '获取到 0 个模型'
    })
  })
})
