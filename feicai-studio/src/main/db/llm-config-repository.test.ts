import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMConfig } from '@shared/types'

type Row = Record<string, unknown>

const rows: Row[] = []
let idCounter = 0

const encryptSecret = vi.fn((value: string) => `enc:${value}`)
const decryptSecret = vi.fn((value: string) => value.replace(/^enc:/, ''))
const hasStoredSecret = vi.fn((value: string | undefined) => Boolean(value))
const maskSecret = vi.fn((value: string | undefined) => {
  if (!value) return undefined
  return `masked:${value}`
})
const migrateSecretIfNeeded = vi.fn((value: string | undefined) => {
  if (!value) return null
  if (value.startsWith('plain:')) return `enc:${value.slice('plain:'.length)}`
  return null
})

function resetRows() {
  rows.splice(0, rows.length)
  idCounter = 0
}

function findRowById(id: string): Row | undefined {
  return rows.find((row) => row.id === id)
}

function createStatement(sql: string) {
  return {
    run: (...args: unknown[]) => {
      if (
        sql.startsWith(
          'UPDATE llm_configs SET is_default = 0 WHERE category = ?'
        )
      ) {
        for (const row of rows) {
          if ((row.category || 'llm') === args[0]) row.is_default = 0
        }
        return
      }

      if (sql.includes('INSERT INTO llm_configs')) {
        rows.push({
          id: args[0],
          name: args[1],
          category: args[2],
          provider: args[3],
          base_url: args[4],
          api_key_encrypted: args[5],
          model: args[6],
          wire_api: args[7],
          reasoning_effort: args[8],
          image_size: args[9],
          image_quality: args[10],
          image_output_format: args[11],
          image_background: args[12],
          max_tokens: args[13],
          temperature: args[14],
          is_default: args[15]
        })
        return
      }

      if (
        sql.startsWith(
          'UPDATE llm_configs SET api_key_encrypted = ? WHERE id = ?'
        )
      ) {
        const row = findRowById(args[1] as string)
        if (row) row.api_key_encrypted = args[0]
        return
      }

      if (
        sql.startsWith('UPDATE llm_configs SET is_default = 1 WHERE id = ?')
      ) {
        const row = findRowById(args[0] as string)
        if (row) row.is_default = 1
        return
      }

      if (sql.startsWith('UPDATE llm_configs SET ')) {
        const id = args[args.length - 1] as string
        const row = findRowById(id)
        if (!row) return

        const assignments = sql
          .slice('UPDATE llm_configs SET '.length, sql.indexOf(' WHERE id = ?'))
          .split(', ')
        assignments.forEach((assignment, index) => {
          const column = assignment.split(' = ?')[0]
          const key = column
          row[key] = args[index]
        })
        return
      }

      if (sql.startsWith('DELETE FROM llm_configs WHERE id = ?')) {
        const index = rows.findIndex((row) => row.id === args[0])
        if (index >= 0) rows.splice(index, 1)
        return
      }

      throw new Error(`Unhandled run SQL: ${sql}`)
    },
    get: (...args: unknown[]) => {
      if (sql.startsWith('SELECT category FROM llm_configs WHERE id = ?')) {
        const row = findRowById(args[0] as string)
        return row ? { category: row.category } : undefined
      }
      if (
        sql.startsWith(
          'SELECT * FROM llm_configs WHERE is_default = 1 AND category = ?'
        )
      ) {
        return rows.find(
          (row) => (row.category || 'llm') === args[0] && row.is_default === 1
        )
      }
      if (sql.startsWith('SELECT * FROM llm_configs WHERE id = ?')) {
        return findRowById(args[0] as string)
      }
      return undefined
    },
    all: () => {
      if (
        sql.startsWith(
          'SELECT * FROM llm_configs ORDER BY category, is_default DESC, name'
        )
      ) {
        return [...rows].sort((a, b) => {
          const categoryCompare = String(a.category || 'llm').localeCompare(
            String(b.category || 'llm')
          )
          if (categoryCompare !== 0) return categoryCompare
          const defaultCompare =
            Number(b.is_default || 0) - Number(a.is_default || 0)
          if (defaultCompare !== 0) return defaultCompare
          return String(a.name).localeCompare(String(b.name))
        })
      }
      return []
    }
  }
}

const mockDb = {
  prepare: vi.fn((sql: string) => createStatement(sql))
}

vi.mock('uuid', () => ({
  v4: () => `cfg-${++idCounter}`
}))

vi.mock('./database', () => ({
  getDatabase: () => mockDb
}))

vi.mock('../llm/secret-store', () => ({
  encryptSecret,
  decryptSecret,
  hasStoredSecret,
  maskSecret,
  migrateSecretIfNeeded
}))

describe('llm-config-repository', async () => {
  const repository = await import('./llm-config-repository')

  const baseConfig: Omit<LLMConfig, 'id'> = {
    name: 'OpenAI',
    category: 'llm',
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    apiKey: 'secret-key',
    model: 'gpt-test',
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: true
  }

  beforeEach(() => {
    resetRows()
    vi.clearAllMocks()
  })

  it('addLLMConfig 会应用默认字段并返回脱敏结果', () => {
    const result = repository.addLLMConfig(baseConfig)

    expect(result.id).toBe('cfg-1')
    expect(result.apiKey).toBe('')
    expect(result.hasStoredApiKey).toBe(true)
    expect(result.apiKeyMasked).toBe('masked:enc:secret-key')
    expect(result.wireApi).toBe('chat-completions')
    expect(result.reasoningEffort).toBe('medium')
    expect(result.imageSize).toBe('1024x1024')
    expect(result.imageQuality).toBe('auto')
    expect(result.imageOutputFormat).toBe('png')
    expect(result.imageBackground).toBe('auto')
    expect(rows[0]?.api_key_encrypted).toBe('enc:secret-key')
  })

  it('updateLLMConfig 会忽略空 API Key，并在设为默认时清空同类默认项', () => {
    rows.push({
      id: 'cfg-old',
      name: 'Old',
      category: 'llm',
      provider: 'openai-compatible',
      base_url: 'https://old.example.com',
      api_key_encrypted: 'enc:old-secret',
      model: 'gpt-old',
      wire_api: 'chat-completions',
      reasoning_effort: 'medium',
      image_size: '1024x1024',
      image_quality: 'auto',
      image_output_format: 'png',
      image_background: 'auto',
      max_tokens: 2048,
      temperature: 0.3,
      is_default: 1
    })
    rows.push({
      id: 'cfg-new',
      name: 'New',
      category: 'llm',
      provider: 'openai-compatible',
      base_url: 'https://new.example.com',
      api_key_encrypted: 'enc:kept-secret',
      model: 'gpt-new',
      wire_api: 'chat-completions',
      reasoning_effort: 'medium',
      image_size: '1024x1024',
      image_quality: 'auto',
      image_output_format: 'png',
      image_background: 'auto',
      max_tokens: 4096,
      temperature: 0.7,
      is_default: 0
    })

    repository.updateLLMConfig('cfg-new', {
      name: 'Updated',
      apiKey: '   ',
      isDefault: true
    })

    expect(findRowById('cfg-old')?.is_default).toBe(0)
    expect(findRowById('cfg-new')?.name).toBe('Updated')
    expect(findRowById('cfg-new')?.api_key_encrypted).toBe('enc:kept-secret')
    expect(findRowById('cfg-new')?.is_default).toBe(1)
  })

  it('listLLMConfigs 会推断缺失字段并迁移旧密钥格式', () => {
    rows.push({
      id: 'cfg-legacy',
      name: 'Legacy',
      category: 'image',
      provider: 'openai-compatible',
      base_url: 'https://subtoapi.526566.xyz/proxy',
      api_key_encrypted: 'plain:legacy-secret',
      model: 'gpt-image',
      max_tokens: 1024,
      temperature: 0.2,
      is_default: 1
    })

    const result = repository.listLLMConfigs()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'cfg-legacy',
      category: 'image',
      wireApi: 'responses',
      reasoningEffort: 'medium',
      imageSize: '1024x1024',
      imageQuality: 'auto',
      imageOutputFormat: 'png',
      imageBackground: 'auto',
      hasStoredApiKey: true,
      apiKeyMasked: 'masked:enc:legacy-secret'
    })
    expect(findRowById('cfg-legacy')?.api_key_encrypted).toBe(
      'enc:legacy-secret'
    )
  })

  it('getDefaultLLMConfig 和 resolveLLMConfigForExecution 会返回解密后的配置', () => {
    rows.push({
      id: 'cfg-default',
      name: 'Default',
      category: 'llm',
      provider: 'openai-compatible',
      base_url: 'https://api.example.com',
      api_key_encrypted: 'plain:stored-secret',
      model: 'gpt-5',
      wire_api: 'chat-completions',
      reasoning_effort: 'high',
      image_size: '1536x1024',
      image_quality: 'high',
      image_output_format: 'webp',
      image_background: 'transparent',
      max_tokens: 8192,
      temperature: 0.5,
      is_default: 1
    })

    const defaultConfig = repository.getDefaultLLMConfig('llm')
    const resolved = repository.resolveLLMConfigForExecution({
      id: 'cfg-default',
      name: '',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: '',
      maxTokens: 0,
      temperature: 0,
      isDefault: false
    })

    expect(defaultConfig?.apiKey).toBe('stored-secret')
    expect(defaultConfig?.reasoningEffort).toBe('high')
    expect(defaultConfig?.imageOutputFormat).toBe('webp')
    expect(resolved.apiKey).toBe('stored-secret')
    expect(resolved.baseUrl).toBe('https://api.example.com')
    expect(resolved.model).toBe('gpt-5')
    expect(findRowById('cfg-default')?.api_key_encrypted).toBe(
      'enc:stored-secret'
    )
  })

  it('resolveLLMConfigForExecution 会优先返回调用方已提供的 API Key，并在缺失记录时报错', () => {
    const passthrough = repository.resolveLLMConfigForExecution({
      id: '',
      name: 'Inline',
      category: 'llm',
      provider: 'openai-compatible',
      baseUrl: 'https://inline.example.com',
      apiKey: 'inline-secret',
      model: 'inline-model',
      maxTokens: 100,
      temperature: 0.1,
      isDefault: false
    })

    expect(passthrough.apiKey).toBe('inline-secret')
    expect(() =>
      repository.resolveLLMConfigForExecution({
        id: 'missing',
        name: '',
        category: 'llm',
        provider: 'openai-compatible',
        baseUrl: '',
        apiKey: '',
        model: '',
        maxTokens: 0,
        temperature: 0,
        isDefault: false
      })
    ).toThrow('模型配置不存在')
  })

  it('setDefaultLLMConfig 和 deleteLLMConfig 会更新存储状态', () => {
    rows.push(
      {
        id: 'cfg-a',
        name: 'A',
        category: 'llm',
        provider: 'openai-compatible',
        base_url: 'https://a.example.com',
        api_key_encrypted: 'enc:a',
        model: 'a',
        is_default: 1
      },
      {
        id: 'cfg-b',
        name: 'B',
        category: 'llm',
        provider: 'openai-compatible',
        base_url: 'https://b.example.com',
        api_key_encrypted: 'enc:b',
        model: 'b',
        is_default: 0
      }
    )

    repository.setDefaultLLMConfig('cfg-b')
    expect(findRowById('cfg-a')?.is_default).toBe(0)
    expect(findRowById('cfg-b')?.is_default).toBe(1)

    repository.deleteLLMConfig('cfg-a')
    expect(findRowById('cfg-a')).toBeUndefined()
  })
})
