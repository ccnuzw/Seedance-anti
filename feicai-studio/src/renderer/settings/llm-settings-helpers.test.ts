import { describe, expect, it } from 'vitest'
import {
  canFetchModelList,
  canSaveConfig,
  canTestConnection,
  countConfigsByCategory,
  formatImageConfigSummary,
  hasUsableApiKey,
  isOpenAIProvider
} from './llm-settings-helpers'

describe('llm-settings-helpers', () => {
  it('正确判断 openai 系 provider', () => {
    expect(isOpenAIProvider('openai')).toBe(true)
    expect(isOpenAIProvider('openai-compatible')).toBe(true)
    expect(isOpenAIProvider('anthropic')).toBe(false)
  })

  it('在编辑且已有存储密钥时允许留空 apiKey', () => {
    expect(hasUsableApiKey('', 'config-1', true)).toBe(true)
    expect(hasUsableApiKey('', null, false)).toBe(false)
    expect(hasUsableApiKey('sk-test', null, false)).toBe(true)
  })

  it('根据字段组合判断获取模型、测试连接和保存是否可用', () => {
    expect(
      canFetchModelList({
        apiKey: '',
        editingId: 'config-1',
        hasStoredApiKey: true,
        baseUrl: 'https://api.openai.com/v1',
        fetchingModels: false
      })
    ).toBe(true)

    expect(
      canTestConnection({
        apiKey: 'sk-test',
        editingId: null,
        hasStoredApiKey: false,
        model: 'gpt-5',
        testing: false
      })
    ).toBe(true)

    expect(
      canSaveConfig({
        name: 'GPT-5',
        apiKey: '',
        editingId: 'config-1',
        hasStoredApiKey: true,
        model: 'gpt-5'
      })
    ).toBe(true)

    expect(
      canSaveConfig({
        name: '',
        apiKey: 'sk-test',
        editingId: null,
        hasStoredApiKey: false,
        model: 'gpt-5'
      })
    ).toBe(false)
  })

  it('格式化图片模型摘要并统计分类数量', () => {
    expect(
      formatImageConfigSummary(
        {
          id: '1',
          name: 'img',
          category: 'image',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-image-2',
          maxTokens: 0,
          temperature: 0,
          isDefault: false,
          imageSize: '1024x1536',
          imageQuality: 'high',
          imageOutputFormat: 'jpeg',
          imageBackground: 'transparent'
        },
        {
          imageSize: '1024x1024',
          imageQuality: 'auto',
          imageOutputFormat: 'png',
          imageBackground: 'auto'
        }
      )
    ).toBe('1024x1536 · high · jpeg · transparent')

    expect(
      countConfigsByCategory(
        [
          {
            id: '1',
            name: 'text',
            category: 'llm',
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-5',
            maxTokens: 0,
            temperature: 0,
            isDefault: true
          },
          {
            id: '2',
            name: 'image',
            category: 'image',
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-image-2',
            maxTokens: 0,
            temperature: 0,
            isDefault: false
          }
        ],
        'image'
      )
    ).toBe(1)
  })
})
