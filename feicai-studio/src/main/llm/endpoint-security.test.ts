import { describe, expect, it } from 'vitest'
import {
  endpointIdentity,
  normalizeBaseEndpoint,
  safeLLMError
} from './endpoint-security'
import { createProvider } from './provider-factory'
import type { LLMConfig } from '@shared/types'

describe('endpoint credential boundary', () => {
  it.each([
    'http://example.com/v1',
    'ftp://localhost/v1',
    'https://user:private-key@example.com/v1',
    'https://private-key@example.com/v1',
    'https://example.com/v1?key=private-key',
    'https://example.com/v1#private-key',
    'https://localhost.example.com@remote.test/v1',
    'not-an-url private-key'
  ])('rejects unsafe endpoints without echoing URL secrets: %s', (baseUrl) => {
    try {
      normalizeBaseEndpoint(baseUrl)
      expect.fail('unsafe URL accepted')
    } catch (error) {
      expect(safeLLMError(error)).not.toContain('private-key')
      expect(safeLLMError(error).length).toBeLessThanOrEqual(240)
    }
  })

  it.each([
    'http://localhost:8080/api',
    'http://127.0.0.1:8080',
    'http://127.0.0.2:8080',
    'http://[::1]:8080'
  ])('permits explicit loopback development endpoints: %s', (baseUrl) => {
    expect(normalizeBaseEndpoint(baseUrl)).toBe(baseUrl)
  })

  it('normalizes origin/trailing slash but binds provider and path separately', () => {
    expect(endpointIdentity('openai', 'https://EXAMPLE.com:443/api/')).toBe(
      endpointIdentity('openai', 'https://example.com/api')
    )
    expect(endpointIdentity('openai', 'https://example.com/api')).not.toBe(
      endpointIdentity('openai', 'https://example.com/other')
    )
    expect(endpointIdentity('openai', 'https://example.com/api')).not.toBe(
      endpointIdentity('openai-compatible', 'https://example.com/api')
    )
  })

  it('never exposes untrusted exception messages or request contents', () => {
    expect(
      safeLLMError(new Error('private-key request-body'.repeat(1000)))
    ).not.toMatch(/private-key|request-body/)
  })

  it('rejects cleared keys before creating any provider connection', () => {
    const config: LLMConfig = {
      id: '',
      name: 'test',
      category: 'llm',
      provider: 'openai',
      baseUrl: 'https://example.com/v1',
      apiKey: '',
      model: 'test',
      maxTokens: 10,
      temperature: 0.1,
      isDefault: false
    }
    expect(() => createProvider(config)).toThrow('请重新填写')
  })
})
