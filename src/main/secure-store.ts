import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'
import { logger, registerSecret, unregisterSecret } from './logger'
import { ensureUserDataDir, getKeysPath } from './paths'
import { maskSecret } from './redaction'

interface EncryptedKeyFile {
  version: 1
  ciphertext: string
}

/** provider id -> API key. Lives only in the main process. */
let cache: Record<string, string> | null = null

function assertEncryptionAvailable(): void {
  if (!safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error(
      'Secure storage is unavailable on this device. API keys cannot be saved, and no plaintext fallback is used.'
    )
  }
}

async function load(): Promise<Record<string, string>> {
  if (cache) return cache

  const path = getKeysPath()
  if (!existsSync(path)) {
    cache = {}
    return cache
  }

  try {
    assertEncryptionAvailable()
    const file = JSON.parse(readFileSync(path, 'utf8')) as EncryptedKeyFile
    if (file.version !== 1 || typeof file.ciphertext !== 'string') {
      throw new Error('Unrecognised key file format')
    }
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(file.ciphertext, 'base64'))
    const parsed = JSON.parse(decrypted.result) as Record<string, unknown>
    const result: Record<string, string> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        result[id] = value
        registerSecret(value)
      }
    }
    cache = result
    // Electron signals when the OS key has rotated; re-encrypt with the new key.
    if (decrypted.shouldReEncrypt) await persist(result)
    return result
  } catch (error) {
    logger.error('secure-store', error)
    throw new Error(
      'Stored keys could not be decrypted on this device. Nothing was exposed or overwritten.'
    )
  }
}

async function persist(entries: Record<string, string>): Promise<void> {
  assertEncryptionAvailable()
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(entries))
  const payload: EncryptedKeyFile = {
    version: 1,
    ciphertext: encrypted.toString('base64')
  }

  ensureUserDataDir()
  const target = getKeysPath()
  const temp = `${target}.tmp`
  writeFileSync(temp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, target)
  cache = entries
}

export async function saveKey(providerId: string, key: string): Promise<void> {
  const entries = { ...(await load()) }
  const previous = entries[providerId]
  if (previous) unregisterSecret(previous)
  entries[providerId] = key
  registerSecret(key)
  await persist(entries)
}

export async function getKey(providerId: string): Promise<string | undefined> {
  return (await load())[providerId]
}

export async function deleteKey(providerId: string): Promise<boolean> {
  const entries = { ...(await load()) }
  if (!entries[providerId]) return false
  unregisterSecret(entries[providerId])
  delete entries[providerId]
  await persist(entries)
  return true
}

export async function hasKey(providerId: string): Promise<boolean> {
  return Boolean((await load())[providerId])
}

export async function getKeyHint(providerId: string): Promise<string> {
  const key = (await load())[providerId]
  return key ? maskSecret(key) : ''
}

/** Explicit user recovery action. Deletes the encrypted file only on success. */
export async function resetKeyStore(): Promise<void> {
  const path = getKeysPath()
  const entries = cache ?? (await load())
  if (existsSync(path)) unlinkSync(path)
  for (const value of Object.values(entries)) unregisterSecret(value)
  cache = {}
}

export async function clearAllKeys(): Promise<void> {
  if (cache) {
    for (const value of Object.values(cache)) unregisterSecret(value)
  }
  cache = {}
  const path = getKeysPath()
  if (existsSync(path)) unlinkSync(path)
}
