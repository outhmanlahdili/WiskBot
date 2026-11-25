import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { closeDatabase, initializeDatabase } from './database'
import { logger } from './logger'
import { getUserDataDir } from './paths'
import { clearAllKeys } from './secure-store'
import { resetSettingsCache } from './settings'

/** Destructive user action from Settings; explicitly confirmed in the UI. */
export async function deleteAllLocalData(): Promise<{ deleted: boolean }> {
  closeDatabase()
  await clearAllKeys()
  resetSettingsCache()

  const dir = getUserDataDir()
  const files = [
    'wiskbot.db',
    'wiskbot.db-shm',
    'wiskbot.db-wal',
    'settings.json',
    'settings.json.tmp',
    'keys.enc',
    'keys.enc.tmp'
  ]
  for (const name of files) {
    const path = join(dir, name)
    if (existsSync(path)) unlinkSync(path)
  }

  initializeDatabase()
  logger.info('data', 'All local WiskBot data was deleted at the user\'s request.')
  return { deleted: true }
}
