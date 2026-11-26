import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'
import { desc, eq } from 'drizzle-orm'
import {
  APP_EVENT_CHANNEL,
  AppEventSchema,
  IpcRequestSchemas,
  type AppEvent,
  type IpcChannel,
  type IpcRequest,
  type IpcResultMap,
  type ToolDescriptor
} from '../shared/ipc'
import { APPROVAL_SECRET } from './agent/secret'
import { cancelRun, respondApproval, runAgent } from './agent/runner'
import { writeAuditEvent } from './audit'
import { deleteAllLocalData } from './data'
import { auditEvents, conversations, getDb, messages } from './database'
import { logger } from './logger'
import { getUserDataDir } from './paths'
import {
  getModelForProvider,
  listProviders,
  removeProvider,
  testProvider,
  upsertProvider
} from './providers/registry'
import { listPublicDefinitions } from './providers/definitions'
import { resetKeyStore } from './secure-store'
import { getSettings, updateSettings } from './settings'

const APP_PROTOCOL = 'wiskbot'
const APP_HOST = 'app'

function isTrustedOrigin(url: string): boolean {
  try {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return true
    const parsed = new URL(url)
    return parsed.protocol === `${APP_PROTOCOL}:` && parsed.host === APP_HOST
  } catch {
    return false
  }
}

function validateSender(event: IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl || !isTrustedOrigin(frameUrl)) {
    throw new Error('IPC request from an untrusted frame was rejected.')
  }
}

export function emitAppEvent(event: AppEvent): void {
  const payload = AppEventSchema.parse(event)
  for (const target of webContents.getAllWebContents()) {
    if (!target.isDestroyed() && isTrustedOrigin(target.getURL())) {
      target.send(APP_EVENT_CHANNEL, payload)
    }
  }
}

function handle<C extends IpcChannel>(
  channel: C,
  fn: (payload: IpcRequest<C>) => IpcResultMap[C] | Promise<IpcResultMap[C]>
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    validateSender(event)
    const payload = IpcRequestSchemas[channel].parse(raw) as IpcRequest<C>
    return fn(payload)
  })
}

/** Metadata only — execution happens in the main process via ToolLoopAgent. */
const PHASE_2_TOOLS: ToolDescriptor[] = [
  {
    name: 'wiskbot.time.now.v1',
    risk: 'read',
    description: 'Current local time and timezone',
    approval: 'allow-once'
  },
  {
    name: 'wiskbot.fs.list.v1',
    risk: 'read',
    description: 'List entries in an allowlisted directory',
    approval: 'ask'
  },
  {
    name: 'wiskbot.fs.read.v1',
    risk: 'read',
    description: 'Read a text file in an allowlisted directory',
    approval: 'ask'
  }
]

export function registerIpcHandlers(): void {
  handle('settings.get', () => getSettings())

  handle('settings.update', (payload) => {
    const before = getSettings()
    const next = updateSettings(payload)
    writeAuditEvent('settings.update', 'settings', 'allow', {
      languageChanged: before.language !== next.language,
      permissionsChanged:
        JSON.stringify(before.permissionDefaults) !== JSON.stringify(next.permissionDefaults)
    })
    if (JSON.stringify(before.permissionDefaults) !== JSON.stringify(next.permissionDefaults)) {
      emitAppEvent({ type: 'permission.changed' })
    }
    return next
  })

  handle('providers.list', () => listProviders())

  handle('providers.definitions', () => listPublicDefinitions())

  handle('providers.upsert', async (payload) => {
    const provider = await upsertProvider(payload)
    emitAppEvent({
      type: 'provider.event',
      providerId: provider.id,
      event: 'saved',
      ok: true
    })
    return provider
  })

  handle('providers.remove', async (payload) => {
    const removed = await removeProvider(payload.id)
    emitAppEvent({
      type: 'provider.event',
      providerId: payload.id,
      event: 'removed',
      ok: removed
    })
    return { removed }
  })

  handle('providers.test', async (payload) => {
    const result = await testProvider(payload.id)
    emitAppEvent({
      type: 'provider.event',
      providerId: payload.id,
      event: 'tested',
      ok: result.ok,
      message: result.message
    })
    return result
  })

  handle('conversations.list', () =>
    getDb()
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .all()
      .map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
  )

  handle('conversations.create', (payload) => {
    const now = new Date()
    const row = {
      id: randomUUID(),
      title: payload.title ?? 'New chat',
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
      settingsJson: '{}'
    }
    getDb().insert(conversations).values(row).run()
    logger.info('conversations', 'Conversation created.', { id: row.id })
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  })

  handle('conversations.delete', (payload) => {
    getDb().delete(conversations).where(eq(conversations.id, payload.id)).run()
    writeAuditEvent('conversations.delete', payload.id, 'allow', {})
    return { removed: true }
  })

  handle('chat.messages', (payload) =>
    getDb()
      .select()
      .from(messages)
      .where(eq(messages.conversationId, payload.conversationId))
      .orderBy(desc(messages.createdAt))
      .all()
      .map((row) => {
        let content = ''
        try {
          const parsed = JSON.parse(row.partsJson) as unknown
          if (typeof parsed === 'string') {
            content = parsed
          } else if (Array.isArray(parsed) && parsed[0] && (parsed[0] as { type?: string }).type === 'text') {
            content = String((parsed[0] as { text?: unknown }).text ?? '')
          } else {
            content = JSON.stringify(parsed)
          }
        } catch {
          content = row.partsJson
        }
        return {
          id: row.id,
          role: row.role as 'user' | 'assistant' | 'tool',
          content,
          createdAt: row.createdAt,
          usageJson: row.usageJson
        }
      })
  )

  handle('chat.send', async (payload) => {
    try {
      const model = await getModelForProvider(payload.providerId)
      const settings = getSettings()
      const dataDir = getUserDataDir()
      void runAgent({
        deps: {
          db: getDb(),
          settings,
          ownDirs: [join(dataDir, 'memory'), join(dataDir, 'skills')],
          model,
          approvalSecret: APPROVAL_SECRET,
          emit: (event) => emitAppEvent({ type: 'chat.event', event })
        },
        conversationId: payload.conversationId,
        text: payload.text
      }).catch((error) => {
        logger.error('agent', error)
      })
      return { accepted: true, conversationId: payload.conversationId }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { accepted: false, conversationId: payload.conversationId, reason }
    }
  })

  handle('chat.cancel', (payload) => {
    const cancelled = payload.conversationId ? cancelRun(payload.conversationId) : false
    return { cancelled }
  })

  handle('chat.respondApproval', (payload) => {
    const recorded = respondApproval(payload.approvalId, payload.decision)
    return {
      recorded,
      reason: recorded ? undefined : 'Approval is no longer pending.'
    }
  })

  handle('tools.list', () => PHASE_2_TOOLS)

  handle('permissions.get', () => getSettings().permissionDefaults)

  handle('audit.list', (payload) =>
    getDb()
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.ts))
      .limit(payload.limit ?? 100)
      .all()
      .map((row) => ({
        id: row.id,
        ts: row.ts,
        actor: row.actor,
        action: row.action,
        target: row.target,
        decision: row.decision,
        detailJson: row.detailJson
      }))
  )

  handle('app.deleteLocalData', async () => deleteAllLocalData())

  handle('app.resetKeyStore', async (payload) => {
    // Payload requires confirmed: true, so an accidental call cannot delete keys.
    void payload
    try {
      await resetKeyStore()
      writeAuditEvent('app.resetKeyStore', 'keys.enc', 'allow', {})
      return { reset: true }
    } catch (error) {
      logger.error('secure-store', error)
      throw new Error('The encrypted key store could not be reset. The existing file was left untouched.')
    }
  })
}
