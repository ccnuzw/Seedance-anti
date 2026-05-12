import { safeStorage } from 'electron'

const ENCRYPTED_PREFIX = 'enc:v1:'
const PLAINTEXT_PREFIX = 'plain:v1:'

export function encryptSecret(secret: string): string {
  if (!secret) return ''

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持安全存储，无法保存 API Key')
  }

  const encrypted = safeStorage.encryptString(secret).toString('base64')
  return `${ENCRYPTED_PREFIX}${encrypted}`
}

export function decryptSecret(storedSecret: string): string {
  if (!storedSecret) return ''

  if (storedSecret.startsWith(ENCRYPTED_PREFIX)) {
    const payload = storedSecret.slice(ENCRYPTED_PREFIX.length)
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  }

  // 兼容旧数据：历史版本直接明文保存。
  if (storedSecret.startsWith(PLAINTEXT_PREFIX)) {
    return storedSecret.slice(PLAINTEXT_PREFIX.length)
  }
  return storedSecret
}

export function isEncryptedSecret(
  storedSecret: string | null | undefined
): boolean {
  return (
    typeof storedSecret === 'string' &&
    storedSecret.startsWith(ENCRYPTED_PREFIX)
  )
}

export function requiresSecretMigration(
  storedSecret: string | null | undefined
): boolean {
  if (!storedSecret) return false
  return !isEncryptedSecret(storedSecret)
}

export function migrateSecretIfNeeded(
  storedSecret: string | null | undefined
): string | null {
  if (!storedSecret) return null
  if (!requiresSecretMigration(storedSecret)) return null

  const raw = decryptSecret(storedSecret)
  if (!raw) return null
  return encryptSecret(raw)
}

export function hasStoredSecret(
  storedSecret: string | null | undefined
): boolean {
  return typeof storedSecret === 'string' && storedSecret.length > 0
}

export function maskSecret(
  storedSecret: string | null | undefined
): string | undefined {
  if (!hasStoredSecret(storedSecret)) return undefined

  const raw = decryptSecret(storedSecret as string)
  if (!raw) return undefined
  if (raw.length <= 4) return '••••'
  return `••••${raw.slice(-4)}`
}
