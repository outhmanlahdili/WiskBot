import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, ChatEvent, Settings } from '../../shared/ipc'
import { resolveBrowserUrl } from '../allowlist'
import { respondApproval, runAgent } from '../agent/runner'
import { BrowserManager, type BrowserControl, type BrowserTransport } from '../browser-worker/manager'
import { closeDatabase, getDb, useDatabaseForTests } from '../database'
import * as schema from '../database/schema'
import { createFakeModel } from '../fake-provider'
import { createTools, TOOL_META, toolNeedsApproval } from '../tools'

const secret = randomBytes(32).toString('base64url')
const fixtureUrl = 'http://127.0.0.1:7788/fixture.html'

let dir: string
let root: string
let settings: Settings
let events: AppEvent[]
let browser: BrowserControl & { calls: string[]; largeSnapshot: boolean }

function makeBrowser(): BrowserControl & { calls: string[]; largeSnapshot: boolean } {
  let currentUrl = fixtureUrl
  let paused = false
  const calls: string[] = []
  const control: BrowserControl & { calls: string[]; largeSnapshot: boolean } = {
    calls,
    largeSnapshot: false,
    get available() {
      return true
    },
    get status() {
      return paused ? 'paused' : ('ready' as const)
    },
    getStatus: () => ({
      status: paused ? 'paused' : 'ready',
      url: currentUrl
    }),
    waitUntilReady: async () => undefined,
    open: async (url) => {
      calls.push(`open:${url}`)
      currentUrl = url
      return { url, title: 'Fixture' }
    },
    snapshot: async () => ({
      untrustedPageContent: true,
      url: currentUrl,
      text: control.largeSnapshot ? 'X'.repeat(100_000) : 'Fixture heading\nA button\nA field',
      truncated: control.largeSnapshot
    }),
    click: async (selector) => {
      calls.push(`click:${selector}`)
      return { clicked: true, selector, url: currentUrl }
    },
    fill: async (selector, value) => {
      if (/#secret|password|token/i.test(selector)) {
        throw new Error('This looks like a secret field. Enter it yourself using Take over.')
      }
      calls.push(`fill:${selector}:${value}`)
      return { filled: true, selector, url: currentUrl }
    },
    screenshot: async () => {
      calls.push('screenshot')
      return { path: join(dir, 'shot.png'), bytes: 128, url: currentUrl }
    },
    setPaused: async (value) => {
      paused = value
      calls.push(`paused:${value}`)
      return { paused: value }
    },
    stop: async () => {
      paused = true
      return { stopped: true }
    }
  }
  return control
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function chatEvents(): ChatEvent[] {
  return events
    .filter((event): event is Extract<AppEvent, { type: 'chat.event' }> => event.type === 'chat.event')
    .map((event) => event.event)
}

function has(kind: ChatEvent['event']): boolean {
  return chatEvents().some((event) => event.event === kind)
}

function approval() {
  return chatEvents().find(
    (event): event is Extract<ChatEvent, { event: 'approval-request' }> =>
      event.event === 'approval-request'
  )
}

beforeEach(() => {
  process.env['WISKBOT_TEST_MODE'] = '1'
  dir = mkdtempSync(join(tmpdir(), 'wiskbot-browser-test-'))
  root = join(dir, 'workspace')
  mkdirSync(root, { recursive: true })
  const sqlite = new Database(join(dir, 'test.db'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  for (const id of ['conv-browser-1', 'conv-browser-2', 'conv-browser-3', 'conv-browser-4']) {
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
    allowedFsRoots: [root],
    browserDomains: ['127.0.0.1'],
    tone: 'concise',
    desktopWindowTitles: [],
    keepAwakeForTasks: true
  }
  events = []
  browser = makeBrowser()
})

afterEach(() => {
  delete process.env['WISKBOT_TEST_MODE']
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('browser domain allowlist', () => {
  it('allows an exact host but rejects subdomains and look-alikes', () => {
    expect(resolveBrowserUrl('https://example.com/page', ['example.com'], true).ok).toBe(true)
    expect(resolveBrowserUrl('https://sub.example.com/page', ['example.com'], true).ok).toBe(false)
    expect(resolveBrowserUrl('https://example.com.attacker.com', ['example.com'], true).ok).toBe(false)
    expect(resolveBrowserUrl('https://notexample.com', ['example.com'], true).ok).toBe(false)
  })

  it('allows file fixtures and loopback only in test mode', () => {
    expect(resolveBrowserUrl('file:///C:/fixture.html', [], false).ok).toBe(false)
    expect(resolveBrowserUrl('file:///C:/fixture.html', [], true).ok).toBe(true)
    expect(resolveBrowserUrl(fixtureUrl, ['127.0.0.1'], false).ok).toBe(false)
    expect(resolveBrowserUrl(fixtureUrl, ['127.0.0.1'], true).ok).toBe(true)
  })
})

describe('browser tools through the agent loop', () => {
  it('requests approval and then opens the page', async () => {
    const run = runAgent({
      deps: {
        db: getDb(),
        settings,
        ownDirs: [join(root, 'memory')],
        skillsDir: dir,
      model: createFakeModel({ getRoot: () => root, getBrowserUrl: () => fixtureUrl }),
        approvalSecret: secret,
        browser,
        emit: (event) => events.push({ type: 'chat.event', event })
      },
      conversationId: 'conv-browser-1',
      text: 'browser open'
    })

    await waitFor(() => has('approval-request'))
    const request = approval()!
    expect(request.toolName).toBe('wiskbot.browser.open.v1')
    expect(request.target).toBe('127.0.0.1')
    expect(request.scope).toContain('managed browser')
    respondApproval(request.approvalId, 'allow-once')
    await run

    expect(browser.calls).toContain(`open:${fixtureUrl}`)
    expect(has('tool-result')).toBe(true)
  })

  it('denies a click without retrying and audits the decision', async () => {
    const run = runAgent({
      deps: {
        db: getDb(),
        settings,
        ownDirs: [join(root, 'memory')],
        skillsDir: dir,
      model: createFakeModel({ getRoot: () => root, getBrowserUrl: () => fixtureUrl }),
        approvalSecret: secret,
        browser,
        emit: (event) => events.push({ type: 'chat.event', event })
      },
      conversationId: 'conv-browser-2',
      text: 'browser deny'
    })

    await waitFor(() => has('approval-request'))
    const request = approval()!
    expect(request.toolName).toBe('wiskbot.browser.click.v1')
    respondApproval(request.approvalId, 'deny')
    await run

    expect(chatEvents().filter((event) => event.event === 'tool-call')).toHaveLength(1)
    expect(browser.calls.some((call) => call.startsWith('click:'))).toBe(false)
    expect(getDb().select().from(schema.auditEvents).all().some((row) => row.decision === 'deny')).toBe(true)
  })

  it('reuses a session grant for a snapshot after an approved open', async () => {
    const deps = {
      db: getDb(),
      settings,
      ownDirs: [join(root, 'memory')],
      skillsDir: dir,
      model: createFakeModel({ getRoot: () => root, getBrowserUrl: () => fixtureUrl }),
      approvalSecret: secret,
      browser,
      emit: (event) => events.push({ type: 'chat.event', event })
    }

    void deps
    const { grantSession } = await import('../permissions')
    grantSession('conv-browser-3', 'wiskbot.browser.open.v1', '127.0.0.1')
    const ctx = {
      conversationId: 'conv-browser-3',
      toolCallId: 'tc_snapshot',
      settings,
      ownDirs: [join(root, 'memory')],
      browser,
      emit: (_event: ChatEvent) => undefined
    }
    const decision = toolNeedsApproval('wiskbot.browser.snapshot.v1', {}, ctx)
    expect(decision.status).toBe('auto-approved')
    expect(TOOL_META['wiskbot.browser.snapshot.v1'].risk).toBe('read')
  })

  it('caps snapshot output and refuses secret fields', async () => {
    browser.largeSnapshot = true
    const tools = createTools({
      conversationId: 'conv-browser-4',
      toolCallId: 'tc_snapshot_cap',
      settings,
      ownDirs: [join(root, 'memory')],
      browser,
      emit: (_event: ChatEvent) => undefined
    }) as unknown as Record<string, { execute: (input?: unknown) => Promise<{ text: string; truncated: boolean } | { refused: boolean; reason: string }> }>

    const snapshot = (await tools['wiskbot.browser.snapshot.v1'].execute()) as {
      text: string
      truncated: boolean
    }
    expect(snapshot.text.length).toBeLessThanOrEqual(32 * 1024)
    expect(snapshot.truncated).toBe(true)

    const typed = (await tools['wiskbot.browser.type.v1'].execute({
      selector: '#secret',
      value: 'hunter2'
    })) as { refused: boolean; reason: string }
    expect(typed.refused).toBe(true)
    expect(browser.calls.some((call) => call.startsWith('fill:'))).toBe(false)
  })
})

describe('worker crash handling', () => {
  it('marks the browser unavailable and emits a clear error', async () => {
    class FakeTransport implements BrowserTransport {
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
    const transport = new FakeTransport()
    const emitted: AppEvent[] = []
    const manager = new BrowserManager({
      emit: (event) => emitted.push({ type: 'chat.event', event }),
      settings: () => settings,
      transportFactory: () => transport,
      userDataDir: dir,
      testMode: true
    })
    manager.start()
    expect(manager.status).toBe('starting')
    transport.emit({ type: 'status', status: 'ready' })
    expect(manager.available).toBe(true)
    transport.crash(1)
    expect(manager.available).toBe(false)
    expect(manager.status).toBe('error')
    expect(emitted.some((event) => event.type === 'chat.event' && event.event.event === 'error')).toBe(true)
    await expect(manager.snapshot()).rejects.toThrow()
  })
})
