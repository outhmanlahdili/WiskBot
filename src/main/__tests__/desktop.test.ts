import { writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, ChatEvent, Settings } from '../../shared/ipc'
import { respondApproval, runAgent } from '../agent/runner'
import { closeDatabase, getDb, useDatabaseForTests } from '../database'
import * as schema from '../database/schema'
import { DesktopManager, type DesktopControl, type DesktopNode, type DesktopTransport } from '../desktop-worker/manager'
import { createFakeModel } from '../fake-provider'
import { createTools, toolNeedsApproval } from '../tools'

const TEST_TITLE = 'Untitled - Notepad'

function makeDesktop(): DesktopControl & { calls: string[] } {
  let paused = false
  const calls: string[] = []
  return {
    calls,
    get available() {
      return true
    },
    get status() {
      return paused ? ('paused' as const) : ('ready' as const)
    },
    waitUntilReady: async () => undefined,
    getStatus: () => ({ status: paused ? 'paused' : 'ready', title: TEST_TITLE }),
    listWindows: async () => ({ windows: [{ title: TEST_TITLE, className: 'Notepad' }] }),
    tree: async () => {
      calls.push('tree')
      const nodes: DesktopNode[] = Array.from({ length: 130 }, (_, index) => ({
        level: 1,
        name: `Control ${index}`,
        automationId: `id-${index}`,
        controlType: 'ControlType.Edit',
        isSecret: false,
        rect: { x: 10, y: 10, width: 100, height: 20 },
        patterns: ['value']
      }))
      return { nodes: nodes.slice(0, 120), truncated: true, untrustedDesktopData: true }
    },
    activate: async () => {
      calls.push('activate')
      return { activated: true }
    },
    invoke: async (_title, selector) => {
      if (/secret|password/i.test(selector)) throw new Error('Refusing a secret control.')
      calls.push(`invoke:${selector}`)
      return { invoked: true, name: 'OK' }
    },
    clickPoint: async (_title, x, y) => {
      calls.push(`point:${x},${y}`)
      return { clicked: true, x, y }
    },
    type: async (_title, selector, value) => {
      if (/secret|password/i.test(selector)) throw new Error('Refusing a secret control.')
      calls.push(`type:${selector}:${value}`)
      return { filled: true }
    },
    readText: async () => ({ untrustedDesktopData: true, text: 'untrusted note', truncated: false }),
    screenshot: async (_title, dir) => {
      calls.push('screenshot')
      return { path: join(dir, 'window-test.png'), bytes: 1234 }
    },
    setPaused: async (value) => {
      paused = value
      return { paused: value }
    },
    stop: async () => {
      paused = true
      return { stopped: true }
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function chatEvents(events: AppEvent[]): ChatEvent[] {
  return events
    .filter((event): event is Extract<AppEvent, { type: 'chat.event' }> => event.type === 'chat.event')
    .map((event) => event.event)
}

let dir: string
let settings: Settings
let desktop: DesktopControl & { calls: string[] }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wiskbot-desktop-test-'))
  const sqlite = new Database(join(dir, 'test.db'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  for (const id of ['conv-desktop-1', 'conv-desktop-2', 'conv-desktop-3']) {
    db.insert(schema.conversations)
      .values({ id, title: 'Test', createdAt: Date.now(), updatedAt: Date.now(), settingsJson: '{}' })
      .run()
  }
  useDatabaseForTests(db, sqlite)
  settings = {
    language: 'en',
    permissionDefaults: {
      read: 'allow-once',
      write: 'ask',
      external: 'ask',
      destructive: 'ask'
    },
    allowedFsRoots: [],
    browserDomains: [],
    tone: 'concise',
    desktopWindowTitles: [TEST_TITLE],
    keepAwakeForTasks: true,
    localModelCatalogs: {},
    mcpServers: []
  }
  desktop = makeDesktop()
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('desktop window allowlist', () => {
  it('rejects titles outside the allowlist', () => {
    const ctx = {
      conversationId: 'conv-desktop-1',
      toolCallId: 'tc_1',
      settings,
      ownDirs: [],
      desktop,
      emit: (_event: ChatEvent) => undefined
    }
    expect(toolNeedsApproval('wiskbot.desktop.tree.v1', { title: 'Secret Window' }, ctx).status).toBe(
      'auto-denied'
    )
    expect(toolNeedsApproval('wiskbot.desktop.tree.v1', { title: TEST_TITLE }, ctx).status).toBe(
      'user-approval'
    )
  })
})

describe('desktop tools', () => {
  it('caps tree output and labels it untrusted', async () => {
    const tools = createTools({
      conversationId: 'conv-desktop-1',
      toolCallId: 'tc_tree',
      settings,
      ownDirs: [],
      desktop,
      emit: (_event: ChatEvent) => undefined
    }) as unknown as Record<string, { execute: (input: Record<string, unknown>) => Promise<{ nodes: DesktopNode[]; truncated: boolean; untrustedDesktopData: boolean }> }>
    const result = await tools['wiskbot.desktop.tree.v1'].execute({ title: TEST_TITLE })
    expect(result.nodes.length).toBeLessThanOrEqual(120)
    expect(result.truncated).toBe(true)
    expect(result.untrustedDesktopData).toBe(true)
  })

  it('refuses to type into secret controls', async () => {
    const tools = createTools({
      conversationId: 'conv-desktop-1',
      toolCallId: 'tc_type',
      settings,
      ownDirs: [],
      desktop,
      emit: (_event: ChatEvent) => undefined
    }) as unknown as Record<string, { execute: (input: Record<string, unknown>) => Promise<{ refused: boolean }> }>
    const result = await tools['wiskbot.desktop.type.v1'].execute({
      title: TEST_TITLE,
      selector: 'id=password',
      value: 'hunter2'
    })
    expect(result.refused).toBe(true)
    expect(desktop.calls.some((call) => call.startsWith('type:'))).toBe(false)
  })

  it('returns a screenshot path only, never bytes', async () => {
    const tools = createTools({
      conversationId: 'conv-desktop-1',
      toolCallId: 'tc_shot',
      settings,
      ownDirs: [],
      desktop,
      screenshotDir: dir,
      emit: (_event: ChatEvent) => undefined
    }) as unknown as Record<string, { execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>> }>
    const result = await tools['wiskbot.desktop.screenshot.v1'].execute({ title: TEST_TITLE })
    expect(typeof result.path).toBe('string')
    expect(result.pngBase64).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('iVBORw0KGgo')
  })

  it('approves a click then executes it', async () => {
    const events: AppEvent[] = []
    const run = runAgent({
      deps: {
        db: getDb(),
        settings,
        ownDirs: [],
        skillsDir: dir,
        desktop,
        model: createFakeModel({
          getRoot: () => dir,
          getDesktopTitle: () => TEST_TITLE
        }),
        approvalSecret: 'test-approval-secret-1234567890',
        emit: (event) => events.push({ type: 'chat.event', event })
      },
      conversationId: 'conv-desktop-2',
      text: 'desktop click'
    })
    await waitFor(() => chatEvents(events).some((event) => event.event === 'approval-request'))
    const request = chatEvents(events).find(
      (event): event is Extract<ChatEvent, { event: 'approval-request' }> =>
        event.event === 'approval-request'
    )!
    expect(request.toolName).toBe('wiskbot.desktop.click.v1')
    expect(request.target).toBe(TEST_TITLE)
    respondApproval(request.approvalId, 'allow-once')
    await run
    expect(desktop.calls.some((call) => call.startsWith('invoke:'))).toBe(true)
  })

  it('denies a click without retrying and audits the decision', async () => {
    const events: AppEvent[] = []
    const run = runAgent({
      deps: {
        db: getDb(),
        settings,
        ownDirs: [],
        skillsDir: dir,
        desktop,
        model: createFakeModel({
          getRoot: () => dir,
          getDesktopTitle: () => TEST_TITLE
        }),
        approvalSecret: 'test-approval-secret-1234567890',
        emit: (event) => events.push({ type: 'chat.event', event })
      },
      conversationId: 'conv-desktop-3',
      text: 'desktop click'
    })
    await waitFor(() => chatEvents(events).some((event) => event.event === 'approval-request'))
    const request = chatEvents(events).find(
      (event): event is Extract<ChatEvent, { event: 'approval-request' }> =>
        event.event === 'approval-request'
    )!
    respondApproval(request.approvalId, 'deny')
    await run
    expect(chatEvents(events).filter((event) => event.event === 'tool-call')).toHaveLength(1)
    expect(desktop.calls.some((call) => call.startsWith('invoke:'))).toBe(false)
    expect(getDb().select().from(schema.auditEvents).all().some((row) => row.decision === 'deny')).toBe(true)
  })
})

describe('worker crash handling', () => {
  it('marks desktop control unavailable and emits a clear error', async () => {
    class FakeTransport implements DesktopTransport {
      private messageHandler: ((data: unknown) => void) | null = null
      private exitHandler: ((code: number) => void) | null = null
      postMessage = vi.fn()
      onMessage(handler: (data: unknown) => void) {
        this.messageHandler = handler
      }
      onExit(handler: (code: number) => void) {
        this.exitHandler = handler
      }
      kill = vi.fn()
      emit(data: unknown) {
        this.messageHandler?.(data)
      }
      crash(code: number) {
        this.exitHandler?.(code)
      }
    }
    const scriptPath = join(dir, 'uia.ps1')
    writeFileSync(scriptPath, '# fake')
    const transport = new FakeTransport()
    const emitted: AppEvent[] = []
    const manager = new DesktopManager({
      emit: (event) => emitted.push({ type: 'chat.event', event }),
      settings: () => settings,
      transportFactory: () => transport,
      scriptPath
    })
    manager.start()
    expect(manager.status).toBe('starting')
    transport.emit({ type: 'status', status: 'ready' })
    expect(manager.available).toBe(true)
    transport.crash(1)
    expect(manager.available).toBe(false)
    expect(manager.status).toBe('error')
    expect(emitted.some((event) => event.type === 'chat.event' && event.event.event === 'error')).toBe(true)
    await expect(manager.tree(TEST_TITLE)).rejects.toThrow()
  })
})
