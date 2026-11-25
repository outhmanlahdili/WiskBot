import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { logger } from '../logger'
import { ensureUserDataDir, getDatabasePath } from '../paths'
import * as schema from './schema'

export type WiskBotDatabase = BetterSQLite3Database<typeof schema>

let sqlite: Database.Database | null = null
let database: WiskBotDatabase | null = null

function migrationsFolder(): string {
  const candidates = [
    join(app.getAppPath(), 'drizzle'),
    join(__dirname, '../../drizzle'),
    join(process.cwd(), 'drizzle')
  ]
  const found = candidates.find((folder) => existsSync(join(folder, 'meta', '_journal.json')))
  if (!found) {
    throw new Error('Drizzle migrations folder was not found next to the application.')
  }
  return found
}

export function initializeDatabase(): void {
  if (sqlite) return

  ensureUserDataDir()
  sqlite = new Database(getDatabasePath())
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: migrationsFolder() })
  logger.info('database', 'Database initialised with migrations applied.')
}

export function getDb(): WiskBotDatabase {
  if (!database) throw new Error('Database has not been initialised.')
  return database
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    database = null
  }
}

export * from './schema'
