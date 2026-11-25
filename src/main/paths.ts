import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** %APPDATA%\WiskBot on Windows. */
export function getUserDataDir(): string {
  return join(app.getPath('appData'), 'WiskBot')
}

export function ensureUserDataDir(): string {
  const dir = getUserDataDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDatabasePath(): string {
  return join(getUserDataDir(), 'wiskbot.db')
}

export function getKeysPath(): string {
  return join(getUserDataDir(), 'keys.enc')
}

export function getSettingsPath(): string {
  return join(getUserDataDir(), 'settings.json')
}
