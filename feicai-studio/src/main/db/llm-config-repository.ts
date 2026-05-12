import { v4 as uuid } from 'uuid'
import { getDatabase } from './database'
import {
  decryptSecret,
  encryptSecret,
  hasStoredSecret,
  maskSecret,
  migrateSecretIfNeeded
} from '../llm/secret-store'
import type { LLMConfig, ModelCategory, OpenAIWireApi } from '@shared/types'

function inferWireApi(row: Record<string, unknown>): OpenAIWireApi {
  const stored = row.wire_api as OpenAIWireApi | undefined
  if (stored === 'responses' || stored === 'chat-completions') return stored

  const baseUrl = String(row.base_url || '')
  if (baseUrl.includes('subtoapi.526566.xyz')) return 'responses'
  return 'chat-completions'
}

function inferReasoningEffort(
  row: Record<string, unknown>
): LLMConfig['reasoningEffort'] {
  const stored = row.reasoning_effort as
    | LLMConfig['reasoningEffort']
    | undefined
  if (
    stored === 'none' ||
    stored === 'low' ||
    stored === 'medium' ||
    stored === 'high' ||
    stored === 'xhigh'
  )
    return stored
  return 'medium'
}

function inferImageSize(row: Record<string, unknown>): LLMConfig['imageSize'] {
  const stored = row.image_size as LLMConfig['imageSize'] | undefined
  if (
    stored === 'auto' ||
    stored === '1024x1024' ||
    stored === '1024x1536' ||
    stored === '1536x1024'
  )
    return stored
  return '1024x1024'
}

function inferImageQuality(
  row: Record<string, unknown>
): LLMConfig['imageQuality'] {
  const stored = row.image_quality as LLMConfig['imageQuality'] | undefined
  if (
    stored === 'auto' ||
    stored === 'low' ||
    stored === 'medium' ||
    stored === 'high'
  )
    return stored
  return 'auto'
}

function inferImageOutputFormat(
  row: Record<string, unknown>
): LLMConfig['imageOutputFormat'] {
  const stored = row.image_output_format as
    | LLMConfig['imageOutputFormat']
    | undefined
  if (stored === 'png' || stored === 'jpeg' || stored === 'webp') return stored
  return 'png'
}

function inferImageBackground(
  row: Record<string, unknown>
): LLMConfig['imageBackground'] {
  const stored = row.image_background as
    | LLMConfig['imageBackground']
    | undefined
  if (stored === 'auto' || stored === 'transparent' || stored === 'opaque')
    return stored
  return 'auto'
}

function getStoredSecret(row: Record<string, unknown>): string {
  return String(row.api_key_encrypted || '')
}

function migrateStoredSecretIfNeeded(id: string, storedSecret: string): string {
  const migratedSecret = migrateSecretIfNeeded(storedSecret)
  if (!migratedSecret) return storedSecret

  const db = getDatabase()
  db.prepare('UPDATE llm_configs SET api_key_encrypted = ? WHERE id = ?').run(
    migratedSecret,
    id
  )
  return migratedSecret
}

export function addLLMConfig(data: Omit<LLMConfig, 'id'>): LLMConfig {
  const db = getDatabase()
  const id = uuid()
  const category = data.category || 'llm'
  const wireApi = data.wireApi || 'chat-completions'
  const reasoningEffort = data.reasoningEffort || 'medium'
  const imageSize = data.imageSize || '1024x1024'
  const imageQuality = data.imageQuality || 'auto'
  const imageOutputFormat = data.imageOutputFormat || 'png'
  const imageBackground = data.imageBackground || 'auto'

  if (data.isDefault) {
    db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(
      category
    )
  }

  db.prepare(
    `
    INSERT INTO llm_configs (
      id, name, category, provider, base_url, api_key_encrypted, model,
      wire_api, reasoning_effort, image_size, image_quality, image_output_format, image_background,
      max_tokens, temperature, is_default
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    data.name,
    category,
    data.provider,
    data.baseUrl,
    encryptSecret(data.apiKey),
    data.model,
    wireApi,
    reasoningEffort,
    imageSize,
    imageQuality,
    imageOutputFormat,
    imageBackground,
    data.maxTokens,
    data.temperature,
    data.isDefault ? 1 : 0
  )

  return {
    ...data,
    id,
    apiKey: '',
    hasStoredApiKey: true,
    apiKeyMasked: maskSecret(encryptSecret(data.apiKey)),
    category,
    wireApi,
    reasoningEffort,
    imageSize,
    imageQuality,
    imageOutputFormat,
    imageBackground
  }
}

export function updateLLMConfig(
  id: string,
  data: Partial<Omit<LLMConfig, 'id'>>
): void {
  const db = getDatabase()
  if (data.isDefault) {
    const row = db
      .prepare('SELECT category FROM llm_configs WHERE id = ?')
      .get(id) as { category: string } | undefined
    const category = data.category || row?.category || 'llm'
    db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(
      category
    )
  }
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) {
    fields.push('name = ?')
    values.push(data.name)
  }
  if (data.category !== undefined) {
    fields.push('category = ?')
    values.push(data.category)
  }
  if (data.provider !== undefined) {
    fields.push('provider = ?')
    values.push(data.provider)
  }
  if (data.baseUrl !== undefined) {
    fields.push('base_url = ?')
    values.push(data.baseUrl)
  }
  if (data.apiKey !== undefined && data.apiKey.trim() !== '') {
    fields.push('api_key_encrypted = ?')
    values.push(encryptSecret(data.apiKey))
  }
  if (data.model !== undefined) {
    fields.push('model = ?')
    values.push(data.model)
  }
  if (data.wireApi !== undefined) {
    fields.push('wire_api = ?')
    values.push(data.wireApi)
  }
  if (data.reasoningEffort !== undefined) {
    fields.push('reasoning_effort = ?')
    values.push(data.reasoningEffort)
  }
  if (data.imageSize !== undefined) {
    fields.push('image_size = ?')
    values.push(data.imageSize)
  }
  if (data.imageQuality !== undefined) {
    fields.push('image_quality = ?')
    values.push(data.imageQuality)
  }
  if (data.imageOutputFormat !== undefined) {
    fields.push('image_output_format = ?')
    values.push(data.imageOutputFormat)
  }
  if (data.imageBackground !== undefined) {
    fields.push('image_background = ?')
    values.push(data.imageBackground)
  }
  if (data.maxTokens !== undefined) {
    fields.push('max_tokens = ?')
    values.push(data.maxTokens)
  }
  if (data.temperature !== undefined) {
    fields.push('temperature = ?')
    values.push(data.temperature)
  }
  if (data.isDefault !== undefined) {
    fields.push('is_default = ?')
    values.push(data.isDefault ? 1 : 0)
  }
  if (fields.length > 0) {
    values.push(id)
    db.prepare(`UPDATE llm_configs SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values
    )
  }
}

export function listLLMConfigs(): LLMConfig[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      'SELECT * FROM llm_configs ORDER BY category, is_default DESC, name'
    )
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    category: (row.category as LLMConfig['category']) || 'llm',
    provider: row.provider as LLMConfig['provider'],
    baseUrl: row.base_url as string,
    apiKey: '',
    hasStoredApiKey: hasStoredSecret(getStoredSecret(row)),
    apiKeyMasked: maskSecret(
      migrateStoredSecretIfNeeded(row.id as string, getStoredSecret(row))
    ),
    model: row.model as string,
    wireApi: inferWireApi(row),
    reasoningEffort: inferReasoningEffort(row),
    imageSize: inferImageSize(row),
    imageQuality: inferImageQuality(row),
    imageOutputFormat: inferImageOutputFormat(row),
    imageBackground: inferImageBackground(row),
    maxTokens: row.max_tokens as number,
    temperature: row.temperature as number,
    isDefault: (row.is_default as number) === 1
  }))
}

export function getDefaultLLMConfig(
  category: ModelCategory = 'llm'
): LLMConfig | null {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM llm_configs WHERE is_default = 1 AND category = ?')
    .get(category) as Record<string, unknown> | undefined
  if (!row) return null
  const storedSecret = migrateStoredSecretIfNeeded(
    row.id as string,
    getStoredSecret(row)
  )
  return {
    id: row.id as string,
    name: row.name as string,
    category: (row.category as LLMConfig['category']) || 'llm',
    provider: row.provider as LLMConfig['provider'],
    baseUrl: row.base_url as string,
    apiKey: decryptSecret(storedSecret),
    model: row.model as string,
    wireApi: inferWireApi(row),
    reasoningEffort: inferReasoningEffort(row),
    imageSize: inferImageSize(row),
    imageQuality: inferImageQuality(row),
    imageOutputFormat: inferImageOutputFormat(row),
    imageBackground: inferImageBackground(row),
    maxTokens: row.max_tokens as number,
    temperature: row.temperature as number,
    isDefault: true
  }
}

export function deleteLLMConfig(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM llm_configs WHERE id = ?').run(id)
}

export function resolveLLMConfigForExecution(config: LLMConfig): LLMConfig {
  if (config.apiKey.trim()) {
    return config
  }

  if (!config.id) {
    throw new Error('缺少 API Key')
  }

  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM llm_configs WHERE id = ?')
    .get(config.id) as Record<string, unknown> | undefined
  if (!row) {
    throw new Error('模型配置不存在')
  }
  const storedSecret = migrateStoredSecretIfNeeded(
    row.id as string,
    getStoredSecret(row)
  )

  return {
    id: config.id || (row.id as string),
    name: config.name || (row.name as string),
    category:
      config.category || (row.category as LLMConfig['category']) || 'llm',
    provider: config.provider || (row.provider as LLMConfig['provider']),
    baseUrl: config.baseUrl || (row.base_url as string),
    apiKey: decryptSecret(storedSecret),
    model: config.model || (row.model as string),
    wireApi: config.wireApi || inferWireApi(row),
    reasoningEffort: config.reasoningEffort || inferReasoningEffort(row),
    imageSize: config.imageSize || inferImageSize(row),
    imageQuality: config.imageQuality || inferImageQuality(row),
    imageOutputFormat: config.imageOutputFormat || inferImageOutputFormat(row),
    imageBackground: config.imageBackground || inferImageBackground(row),
    maxTokens: config.maxTokens ?? (row.max_tokens as number),
    temperature: config.temperature ?? (row.temperature as number),
    isDefault: config.isDefault ?? (row.is_default as number) === 1
  }
}

export function setDefaultLLMConfig(id: string): void {
  const db = getDatabase()
  const row = db
    .prepare('SELECT category FROM llm_configs WHERE id = ?')
    .get(id) as { category: string } | undefined
  const category = row?.category || 'llm'
  db.prepare('UPDATE llm_configs SET is_default = 0 WHERE category = ?').run(
    category
  )
  db.prepare('UPDATE llm_configs SET is_default = 1 WHERE id = ?').run(id)
}
