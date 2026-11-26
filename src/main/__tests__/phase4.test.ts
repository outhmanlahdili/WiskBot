import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvent, ChatEvent, Settings } from '../../shared/ipc'
import { respondApproval, runAgent, systemInstructions } from '../agent/runner'
import { closeDatabase, getDb, useDatabaseForTests } from '../database'
import * as schema from '../database/schema'
import { createFakeModel } from '../fake-provider'
import {
  buildMemoryIndex,
  listMemories,
  recallMemories,
  saveMemory,
  setMemoryEnabled
} from '../memory'
import { grantSession } from '../permissions'
import {
  ensureBuiltinSkill,
  invokeSkill,
  listSkills,
  missingSkillScopes,
  setSkillEnabled,
  SkillManifestSchema
} from '../skills'
import { createTools, toolNeedsApproval, TOOL_META } from '../tools'

let dir: string
let settings: Settings

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

function invocationApproval(events: AppEvent[]) {
  return chatEvents(events).find(
    (event): event is Extract<ChatEvent, { event: 'approval-request' }> =>
      event.event === 'approval-request' && event.toolName === 'wiskbot.skill.invoke.v1'
  )
}

function skillDeps(events: AppEvent[]) {
  return {
    db: getDb(),
    settings,
    ownDirs: [],
    skillsDir: dir,
    model: createFakeModel({ getRoot: () => dir }),
    approvalSecret: 'test-approval-secret-1234567890',
    emit: (event: ChatEvent) => events.push({ type: 'chat.event', event })
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wiskbot-phase4-test-'))
  const sqlite = new Database(join(dir, 'test.db'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  db.insert(schema.conversations)
    .values({
      id: 'conv-skill-fix',
      title: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      settingsJson: '{}'
    })
    .run()
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
    desktopWindowTitles: []
  }
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('memory service', () => {
  it('saves and recalls a memory with an audit record', () => {
    const saved = saveMemory({
      kind: 'preference',
      content: 'Likes mint tea',
      source: 'chat'
    })
    expect(saved.id).toMatch(/^mem_/)
    expect(saved.trusted).toBe(true)

    const recalled = recallMemories('mint', 8)
    expect(recalled.results.some((item) => item.id === saved.id)).toBe(true)
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'memory.save')).toBe(true)
    expect(audits.some((row) => row.action === 'memory.recall')).toBe(true)
  })

  it('caps the injected memory index', () => {
    for (let index = 0; index < 30; index++) {
      saveMemory({ kind: 'fact', content: `Fact ${index}: ${'x'.repeat(200)}`, source: 'chat' })
    }
    const index = buildMemoryIndex(200)
    const bytes = index.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry), 'utf8'), 0)
    expect(bytes).toBeLessThanOrEqual(200)
    expect(index.length).toBeLessThan(30)
  })

  it('labels imported memory as untrusted but settings memory as trusted', () => {
    saveMemory({ kind: 'preference', content: 'Created in Settings', source: 'settings' })
    saveMemory({ kind: 'imported', content: 'Imported project note', source: 'project' })
    const byContent = new Map(listMemories().map((memory) => [memory.content, memory]))
    expect(byContent.get('Created in Settings')?.trusted).toBe(true)
    expect(byContent.get('Imported project note')?.trusted).toBe(false)
    expect(buildMemoryIndex().some((entry) => entry.trusted === false)).toBe(true)
    expect(recallMemories('Imported', 8).results[0].trusted).toBe(false)
  })

  it('disables a memory', () => {
    const saved = saveMemory({ kind: 'fact', content: 'Temporary', source: 'chat' })
    const updated = setMemoryEnabled(saved.id, false)
    expect(updated?.enabled).toBe(false)
    expect(recallMemories('Temporary', 8).results).toHaveLength(0)
  })
})

describe('preferences and system instructions', () => {
  it('uses tone in the system instructions', () => {
    expect(systemInstructions('friendly')).toContain('warm, friendly')
    expect(systemInstructions('formal')).toContain('formal, precise')
    expect(systemInstructions('concise')).toContain('short and direct')
    expect(systemInstructions('concise')).toContain('untrusted')
  })

  it('includes only the memory index, not full content', () => {
    saveMemory({ kind: 'fact', content: 'Secret long body '.repeat(100), source: 'chat' })
    const instructions = systemInstructions('concise', buildMemoryIndex(400))
    expect(instructions).toContain('memory.recall')
    expect(instructions).not.toContain('Secret long body '.repeat(50))
  })
})

describe('skills', () => {
  it('rejects an invalid manifest', () => {
    expect(
      SkillManifestSchema.safeParse({ name: 'Bad', version: 'x' }).success
    ).toBe(false)
  })

  it('creates a disabled built-in skill on first run', () => {
    ensureBuiltinSkill(dir)
    const skills = listSkills()
    expect(skills).toHaveLength(1)
    expect(skills[0].enabled).toBe(false)
    expect(skills[0].name).toBe('Summarise a folder')
  })

  it('rejects undeclared scopes', () => {
    const missing = missingSkillScopes(['wiskbot.unknown.v1'], Object.keys(TOOL_META))
    expect(missing).toEqual(['wiskbot.unknown.v1'])
  })

  it('refuses to invoke a disabled skill and requires valid scopes', () => {
    ensureBuiltinSkill(dir)
    expect(() => invokeSkill('folder-summary', Object.keys(TOOL_META), dir)).toThrow('disabled')
    setSkillEnabled('folder-summary', true)
    const invoked = invokeSkill('folder-summary', Object.keys(TOOL_META), dir)
    expect(invoked.instructions).toContain('Summarise a folder')
    expect(invoked.requiredScopes).toContain('wiskbot.fs.list.v1')
  })

  it('allow-once asks again on the second skill invocation', async () => {
    ensureBuiltinSkill(dir)
    setSkillEnabled('folder-summary', true)

    const firstEvents: AppEvent[] = []
    const firstRun = runAgent({
      deps: skillDeps(firstEvents),
      conversationId: 'conv-skill-fix',
      text: 'skill invoke'
    })
    await waitFor(() => Boolean(invocationApproval(firstEvents)))
    respondApproval(invocationApproval(firstEvents)!.approvalId, 'allow-once')
    await firstRun

    const secondEvents: AppEvent[] = []
    const secondRun = runAgent({
      deps: skillDeps(secondEvents),
      conversationId: 'conv-skill-fix',
      text: 'skill invoke'
    })
    await waitFor(() => Boolean(invocationApproval(secondEvents)))
    respondApproval(invocationApproval(secondEvents)!.approvalId, 'deny')
    await secondRun
    expect(invocationApproval(secondEvents)).toBeDefined()
  })

  it('allow-session reuses the grant on the second skill invocation', async () => {
    ensureBuiltinSkill(dir)
    setSkillEnabled('folder-summary', true)

    const firstEvents: AppEvent[] = []
    const firstRun = runAgent({
      deps: skillDeps(firstEvents),
      conversationId: 'conv-skill-fix',
      text: 'skill invoke'
    })
    await waitFor(() => Boolean(invocationApproval(firstEvents)))
    respondApproval(invocationApproval(firstEvents)!.approvalId, 'allow-session')
    await firstRun

    const secondEvents: AppEvent[] = []
    await runAgent({
      deps: skillDeps(secondEvents),
      conversationId: 'conv-skill-fix',
      text: 'skill invoke'
    })
    expect(invocationApproval(secondEvents)).toBeUndefined()
    expect(chatEvents(secondEvents).some((event) => event.event === 'tool-call')).toBe(true)
  })

  it('requires approval on first use and reuses a session grant', () => {
    const ctx = {
      conversationId: 'conv-skill',
      toolCallId: 'tc_skill',
      settings,
      ownDirs: [],
      emit: (_event: ChatEvent) => undefined
    }
    expect(
      toolNeedsApproval('wiskbot.skill.invoke.v1', { skillId: 'folder-summary' }, ctx).status
    ).toBe('user-approval')
    grantSession('conv-skill', 'wiskbot.skill.invoke.v1', 'folder-summary')
    expect(
      toolNeedsApproval('wiskbot.skill.invoke.v1', { skillId: 'folder-summary' }, ctx).status
    ).toBe('auto-approved')
  })
})

describe('memory tools', () => {
  it('wires save and recall through createTools', async () => {
    const tools = createTools({
      conversationId: 'conv-memory-tool',
      toolCallId: 'tc_memory_tool',
      settings,
      ownDirs: [],
      emit: (_event: ChatEvent) => undefined
    }) as unknown as Record<string, {
      execute: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    }>

    const saved = await tools['wiskbot.memory.save.v1'].execute({
      kind: 'fact',
      content: 'Prefers Arabic RTL'
    })
    expect(saved.saved).toBe(true)
    const recalled = await tools['wiskbot.memory.recall.v1'].execute({ query: 'Arabic', limit: 8 })
    expect(recalled.untrustedMemoryContent).toBe(true)
    expect(JSON.stringify(recalled.results)).toContain('Prefers Arabic RTL')
    expect(toolNeedsApproval('wiskbot.memory.save.v1', {}, {
      conversationId: 'conv-memory-tool',
      toolCallId: 'tc_memory_tool',
      settings,
      ownDirs: [],
      emit: (_event: ChatEvent) => undefined
    }).status).toBe('user-approval')
  })

  it('audits skill enable changes', () => {
    ensureBuiltinSkill(dir)
    setSkillEnabled('folder-summary', true)
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'skill.setEnabled' && row.decision === 'allow')).toBe(true)
  })
})
