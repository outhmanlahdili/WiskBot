import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatEvent, Settings } from '../../shared/ipc'
import { closeDatabase, getDb, useDatabaseForTests } from '../database'
import * as schema from '../database/schema'
import {
  callMcpTool,
  configHash,
  flattenMcpSchema,
  isReadOnlyTool,
  isServerUnavailable,
  refreshMcpTools,
  SCHEMA_EXAMPLE,
  type McpClientLike,
  type McpToolLike
} from '../mcp/service'
import { refreshLocalModels } from '../providers/registry'
import { registerMcpToolMeta, toolNeedsApproval } from '../tools'
import { grantSession } from '../permissions'

let dir: string
let settings: Settings

const serverConfig = {
  id: 'mcp_test',
  name: 'Fake MCP',
  transport: 'stdio' as const,
  target: 'fake-mcp-server',
  enabled: true,
  versionHash: configHash({ transport: 'stdio', target: 'fake-mcp-server' })
}

const readOnlyTool: McpToolLike = {
  name: 'read_note',
  description: 'Read a note',
  annotations: { readOnlyHint: true },
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query']
  }
}

function fakeFactory(tools: McpToolLike[], fail = false): () => Promise<McpClientLike> {
  return async () => {
    if (fail) throw new Error('connection refused')
    return {
      listTools: async () => ({ tools }),
      callTool: async (name, args) => ({ called: name, args }),
      close: async () => undefined
    }
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wiskbot-mcp-test-'))
  const sqlite = new Database(join(dir, 'test.db'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  db.insert(schema.providers)
    .values({
      id: 'local-test',
      kind: 'ollama',
      displayName: 'Local',
      baseUrl: 'http://localhost:11434/v1',
      modelId: '',
      enabled: true,
      capabilitiesJson: '{}'
    })
    .run()
  useDatabaseForTests(db, sqlite)
  settings = {
    language: 'en',
    permissionDefaults: { read: 'allow-once', write: 'ask', external: 'ask', destructive: 'ask' },
    allowedFsRoots: [],
    browserDomains: [],
    tone: 'concise',
    desktopWindowTitles: [],
    keepAwakeForTasks: true,
    localModelCatalogs: {},
    mcpServers: [serverConfig]
  }
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('MCP schema filtering', () => {
  it('rejects composition keywords with a literal example', () => {
    for (const keyword of ['oneOf', 'anyOf', 'allOf', 'const', 'format']) {
      const result = flattenMcpSchema({
        type: 'object',
        properties: {},
        [keyword]: [{ type: 'string' }]
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain(keyword)
        expect(result.error).toContain(SCHEMA_EXAMPLE)
      }
    }
  })

  it('accepts a plain object schema and coerces stringified values', () => {
    const result = flattenMcpSchema({
      type: 'object',
      properties: { query: { type: 'string' }, count: { type: 'number' }, flag: { type: 'boolean' } }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.zod.parse({ query: 'a', count: '3', flag: 'true' })).toEqual({
        query: 'a',
        count: 3,
        flag: true
      })
    }
  })

  it('filters out write tools even with readOnlyHint', () => {
    expect(isReadOnlyTool(readOnlyTool)).toBe(true)
    expect(
      isReadOnlyTool({ ...readOnlyTool, name: 'send_message', annotations: { readOnlyHint: true } })
    ).toBe(false)
    expect(isReadOnlyTool({ ...readOnlyTool, annotations: {} })).toBe(false)
  })
})

describe('MCP tool lifecycle', () => {
  it('lists read-only tools and refuses composition schemas', async () => {
    const badTool: McpToolLike = {
      ...readOnlyTool,
      name: 'bad_tool',
      inputSchema: { type: 'object', properties: { x: { oneOf: [] } } }
    }
    const result = await refreshMcpTools(settings, fakeFactory([readOnlyTool, badTool]))
    expect(result.tools.map((tool) => tool.name)).toEqual(['mcp.mcp_test.read_note'])
    expect(result.tools[0].readOnly).toBe(true)
    expect(result.errors.some((error) => error.includes(SCHEMA_EXAMPLE))).toBe(true)
    registerMcpToolMeta(result.tools)
  })

  it('rejects a write tool offered by the server', async () => {
    const result = await refreshMcpTools(
      settings,
      fakeFactory([{ ...readOnlyTool, name: 'delete_file', annotations: { readOnlyHint: true } }])
    )
    expect(result.tools).toHaveLength(0)
  })

  it('requires approval before execution and reuses a session grant', async () => {
    const result = await refreshMcpTools(settings, fakeFactory([readOnlyTool]))
    registerMcpToolMeta(result.tools)
    const name = 'mcp.mcp_test.read_note'
    const ctx = {
      conversationId: 'conv-mcp',
      toolCallId: 'tc_mcp',
      settings,
      ownDirs: [],
      emit: (_event: ChatEvent) => undefined
    }
    expect(toolNeedsApproval(name, { query: 'hello' }, ctx).status).toBe('user-approval')
    grantSession('conv-mcp', name, `mcp_test@${serverConfig.versionHash}`)
    expect(toolNeedsApproval(name, { query: 'hello' }, ctx).status).toBe('auto-approved')

    const called = await callMcpTool(name, { query: 'hello' }, settings, fakeFactory([readOnlyTool]))
    expect(called).toEqual({ called: 'read_note', args: { query: 'hello' } })
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'mcp.call' && row.target === name)).toBe(true)
  })

  it('invalidates saved approval when the server config changes', async () => {
    const result = await refreshMcpTools(settings, fakeFactory([readOnlyTool]))
    const name = result.tools[0].name
    const changed = {
      ...settings,
      mcpServers: [
        { ...serverConfig, target: 'fake-mcp-server-v2', versionHash: configHash({ transport: 'stdio', target: 'fake-mcp-server-v2' }) }
      ]
    }
    await expect(callMcpTool(name, { query: 'x' }, changed, fakeFactory([readOnlyTool]))).rejects.toThrow(
      /configuration changed|not available/
    )
  })

  it('marks a server unavailable when it cannot connect', async () => {
    const result = await refreshMcpTools(settings, fakeFactory([], true))
    expect(result.tools).toHaveLength(0)
    expect(result.errors.some((error) => error.includes('connection refused'))).toBe(true)
    expect(isServerUnavailable(serverConfig.id)).toBe(true)
  })
})

describe('local model profiles', () => {
  it('refuses a key for local endpoints and lists models', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'llama3.2' }, { id: 'qwen2.5' }] })
    })
    const result = await refreshLocalModels('local-test', fakeFetch)
    expect(result.models).toEqual(['llama3.2', 'qwen2.5'])
    expect(result.error).toBeUndefined()
  })

  it('reports connection failure without blocking', async () => {
    const failing = async () => {
      throw new Error('ECONNREFUSED')
    }
    const result = await refreshLocalModels('local-test', failing)
    expect(result.models).toEqual([])
    expect(result.error).toMatch(/ECONNREFUSED/)
    const row = getDb().select().from(schema.providers).where(eq(schema.providers.id, 'local-test')).get()
    expect(row?.enabled).toBe(true)
  })
})
