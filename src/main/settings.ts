import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { SettingsSchema, type Settings } from '../shared/ipc'
import { logger } from './logger'
import { ensureUserDataDir, getSettingsPath } from './paths'
import { DEFAULT_PERMISSION_DEFAULTS } from './permissions'

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  permissionDefaults: { ...DEFAULT_PERMISSION_DEFAULTS },
  allowedFsRoots: []
}

let cached: Settings | null = null

export function getSettings(): Settings {
  if (!cached) cached = load()
  return cached
}

function load(): Settings {
  const path = getSettingsPath()
  if (!existsSync(path)) return structuredClone(DEFAULT_SETTINGS)
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return SettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...stored,
      permissionDefaults: {
        ...DEFAULT_PERMISSION_DEFAULTS,
        ...((stored.permissionDefaults as object) ?? {})
      },
      allowedFsRoots: Array.isArray(stored.allowedFsRoots) ? stored.allowedFsRoots : []
    })
  } catch (error) {
    logger.warn('settings', 'Stored settings were invalid; defaults were used.', {
      error: String(error)
    })
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const next = SettingsSchema.parse({
    ...current,
    ...patch,
    permissionDefaults: {
      ...current.permissionDefaults,
      ...(patch.permissionDefaults ?? {})
    },
    allowedFsRoots: patch.allowedFsRoots ?? current.allowedFsRoots
  })

  ensureUserDataDir()
  const target = getSettingsPath()
  const temp = `${target}.tmp`
  writeFileSync(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, target)
  cached = next
  return next
}

export function resetSettingsCache(): void {
  cached = null
}
