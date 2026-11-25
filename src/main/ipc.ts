import { randomUUID } from 'node:crypto'
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
import { writeAuditEvent } from './audit'
import { deleteAllLocalData } from './data'
import { auditEvents, conversations, getDb } from './database'
import { logger } from './logger'
import { listProviders, removeProvider, testProvider, upsertProvider } from './providers/registry'
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

/** Metadata only — no tool is executed in Phase 1. */
const PHASE_1_TOOLS: ToolDescriptor[] = [
  {
    name: 'wiskbot.time.now.v1',
    risk: 'read',
    description: 'Current local time and timezone',
    approval: 'allow-once'
  },
  {
    name: 'wiskbot.providers.test.v1',
    risk: 'external',
    description: 'Generate a short response with the selected provider',
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

  // Explicit Phase 1 stubs: the schema and handler exist, the agent loop does not.
  handle('chat.send', (payload) => {
    const reason = 'The agent loop is not implemented in Phase 1.'
    emitAppEvent({
      type: 'chat.event',
      conversationId: payload.conversationId,
      event: 'error',
      data: { message: reason }
    })
    return { accepted: false, conversationId: payload.conversationId, reason }
  })

  handle('chat.cancel', () => ({ cancelled: true }))

  handle('chat.respondApproval', () => ({
    recorded: false,
    reason: 'No approval flow is active in Phase 1.'
  }))

  handle('tools.list', () => PHASE_1_TOOLS)

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
}
