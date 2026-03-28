import { describe, expect, it } from 'vitest'
import { resolveNotaryCredentials } from './notarize.mjs'

describe('notarize', () => {
  it('prefers api key credentials when available', () => {
    expect(resolveNotaryCredentials({
      APPLE_API_KEY: '/tmp/AuthKey.p8',
      APPLE_API_KEY_ID: 'ABC123',
      APPLE_API_ISSUER: 'issuer-id',
      APPLE_ID: 'user@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAMID'
    })).toEqual({
      tool: 'notarytool',
      appleApiKey: '/tmp/AuthKey.p8',
      appleApiKeyId: 'ABC123',
      appleApiIssuer: 'issuer-id'
    })
  })

  it('supports apple id credentials', () => {
    expect(resolveNotaryCredentials({
      APPLE_ID: 'user@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAMID'
    })).toEqual({
      tool: 'notarytool',
      appleId: 'user@example.com',
      appleIdPassword: 'app-password',
      teamId: 'TEAMID'
    })
  })

  it('returns null when credentials are incomplete', () => {
    expect(resolveNotaryCredentials({
      APPLE_ID: 'user@example.com'
    })).toBeNull()
  })
})
