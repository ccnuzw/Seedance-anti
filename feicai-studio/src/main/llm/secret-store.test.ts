import { beforeEach, describe, expect, it, vi } from 'vitest'

const isEncryptionAvailable = vi.fn()
const encryptString = vi.fn()
const decryptString = vi.fn()

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable,
    encryptString,
    decryptString
  }
}))

describe('secret-store', async () => {
  const secretStore = await import('./secret-store')

  beforeEach(() => {
    vi.clearAllMocks()
    isEncryptionAvailable.mockReturnValue(true)
    encryptString.mockImplementation((value: string) =>
      Buffer.from(`enc:${value}`)
    )
    decryptString.mockImplementation((value: Buffer) =>
      value.toString().replace(/^enc:/, '')
    )
  })

  it('encryptSecret 会返回带前缀的密文', () => {
    expect(secretStore.encryptSecret('abc123')).toBe(
      `enc:v1:${Buffer.from('enc:abc123').toString('base64')}`
    )
  })

  it('encryptSecret 在系统不支持安全存储时抛错', () => {
    isEncryptionAvailable.mockReturnValue(false)

    expect(() => secretStore.encryptSecret('abc123')).toThrow(
      '当前系统不支持安全存储，无法保存 API Key'
    )
  })

  it('decryptSecret 支持加密、plain 前缀和历史裸值', () => {
    const encrypted = `enc:v1:${Buffer.from('enc:token-1').toString('base64')}`

    expect(secretStore.decryptSecret(encrypted)).toBe('token-1')
    expect(secretStore.decryptSecret('plain:v1:token-2')).toBe('token-2')
    expect(secretStore.decryptSecret('token-3')).toBe('token-3')
  })

  it('requiresSecretMigration 和 isEncryptedSecret 能识别迁移状态', () => {
    expect(secretStore.isEncryptedSecret('enc:v1:abc')).toBe(true)
    expect(secretStore.isEncryptedSecret('plain:v1:abc')).toBe(false)
    expect(secretStore.requiresSecretMigration('plain:v1:abc')).toBe(true)
    expect(secretStore.requiresSecretMigration('legacy-token')).toBe(true)
    expect(secretStore.requiresSecretMigration('enc:v1:abc')).toBe(false)
    expect(secretStore.requiresSecretMigration('')).toBe(false)
  })

  it('migrateSecretIfNeeded 会把旧格式升级为加密格式', () => {
    const migrated = secretStore.migrateSecretIfNeeded('plain:v1:legacy-token')

    expect(migrated).toBe(
      `enc:v1:${Buffer.from('enc:legacy-token').toString('base64')}`
    )
    expect(secretStore.migrateSecretIfNeeded('enc:v1:already')).toBeNull()
    expect(secretStore.migrateSecretIfNeeded('')).toBeNull()
  })

  it('maskSecret 会按规则脱敏', () => {
    const encrypted = `enc:v1:${Buffer.from('enc:sk-test-1234').toString('base64')}`

    expect(secretStore.maskSecret(encrypted)).toBe('••••1234')
    expect(secretStore.maskSecret('plain:v1:abc')).toBe('••••')
    expect(secretStore.maskSecret('')).toBeUndefined()
  })

  it('hasStoredSecret 仅在有非空值时返回 true', () => {
    expect(secretStore.hasStoredSecret('value')).toBe(true)
    expect(secretStore.hasStoredSecret('')).toBe(false)
    expect(secretStore.hasStoredSecret(undefined)).toBe(false)
    expect(secretStore.hasStoredSecret(null)).toBe(false)
  })
})
