import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  MemoryUpsertSchema,
  type MemoryKind,
  type MemoryRecord
} from '../shared/ipc'
import { writeAuditEvent } from './audit'
import { getDb, memories } from './database'

export const MAX_MEMORIES = 200
export const MAX_INDEX_BYTES = 8 * 1024
export const MAX_RECALL_BYTES = 12 * 1024
export const MAX_PREVIEW_CHARS = 120

const TRUSTED_SOURCES = new Set(['chat', 'settings'])

export function isTrustedMemory(source: string | null): boolean {
  return source !== null && TRUSTED_SOURCES.has(source)
}

function toRecord(row: typeof memories.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    enabled: row.enabled,
    trusted: isTrustedMemory(row.source)
  }
}

export function listMemories(enabledOnly = false): MemoryRecord[] {
  const rows = getDb().select().from(memories).all()
  return rows
    .filter((row) => !enabledOnly || row.enabled)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toRecord)
}

export function saveMemory(input: unknown): MemoryRecord {
  const parsed = MemoryUpsertSchema.parse(input)
  const db = getDb()
  const existing = db.select().from(memories).all()
  const now = Date.now()
  const id = parsed.id ?? `mem_${randomUUID().slice(0, 12)}`
  const record = {
    id,
    kind: parsed.kind,
    content: parsed.content,
    source: parsed.source ?? 'chat',
    confidence: parsed.confidence ?? 1,
    createdAt: now,
    updatedAt: now,
    enabled: true
  }

  if (existing.length >= MAX_MEMORIES && !existing.some((row) => row.id === id)) {
    throw new Error(`Memory limit reached (${MAX_MEMORIES}). Delete an entry before saving another.`)
  }
  db.insert(memories)
    .values(record)
    .onConflictDoUpdate({
      target: memories.id,
      set: {
        kind: record.kind,
        content: record.content,
        source: record.source,
        confidence: record.confidence,
        updatedAt: record.updatedAt
      }
    })
    .run()
  writeAuditEvent('memory.save', id, 'allow', {
    kind: record.kind,
    source: record.source,
    bytes: Buffer.byteLength(record.content, 'utf8')
  })
  return toRecord(record)
}

export function updateMemory(id: string, patch: { content?: string; kind?: MemoryKind; confidence?: number }): MemoryRecord | null {
  const db = getDb()
  const row = db.select().from(memories).where(eq(memories.id, id)).get()
  if (!row) return null
  if (patch.content !== undefined && patch.content.trim().length === 0) {
    throw new Error('Memory content cannot be empty.')
  }
  if (patch.content && Buffer.byteLength(patch.content, 'utf8') > 4096) {
    throw new Error('Memory content exceeds the 4 KB limit.')
  }
  const updated = {
    kind: patch.kind ?? row.kind,
    content: patch.content ?? row.content,
    confidence: patch.confidence ?? row.confidence,
    updatedAt: Date.now()
  }
  db.update(memories).set(updated).where(eq(memories.id, id)).run()
  writeAuditEvent('memory.update', id, 'allow', { fields: Object.keys(patch) })
  return toRecord({ ...row, ...updated })
}

export function deleteMemory(id: string): boolean {
  const db = getDb()
  const row = db.select().from(memories).where(eq(memories.id, id)).get()
  if (!row) return false
  db.delete(memories).where(eq(memories.id, id)).run()
  writeAuditEvent('memory.delete', id, 'allow', { kind: row.kind })
  return true
}

export function setMemoryEnabled(id: string, enabled: boolean): MemoryRecord | null {
  const db = getDb()
  const row = db.select().from(memories).where(eq(memories.id, id)).get()
  if (!row) return null
  db.update(memories).set({ enabled, updatedAt: Date.now() }).where(eq(memories.id, id)).run()
  writeAuditEvent('memory.setEnabled', id, enabled ? 'allow' : 'deny', { enabled })
  return toRecord({ ...row, enabled })
}

export interface MemoryIndexEntry {
  id: string
  kind: string
  preview: string
  trusted: boolean
}

/** Only an index is injected; full content is fetched with memory.recall. */
export function buildMemoryIndex(maxBytes = MAX_INDEX_BYTES): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = []
  let bytes = 0
  for (const memory of listMemories(true)) {
    const entry: MemoryIndexEntry = {
      id: memory.id,
      kind: memory.kind,
      preview: memory.content.slice(0, MAX_PREVIEW_CHARS),
      trusted: memory.trusted
    }
    const cost = Buffer.byteLength(JSON.stringify(entry), 'utf8')
    if (bytes + cost > maxBytes) break
    bytes += cost
    entries.push(entry)
  }
  return entries
}

export function recallMemories(
  query: string,
  limit = 8,
  maxBytes = MAX_RECALL_BYTES
): { results: Array<{ id: string; kind: string; content: string; trusted: boolean }>; truncated: boolean } {
  const needle = query.trim().toLowerCase()
  const candidates = listMemories(true).filter(
    (memory) => !needle || memory.content.toLowerCase().includes(needle) || memory.kind.includes(needle)
  )
  const results: Array<{ id: string; kind: string; content: string; trusted: boolean }> = []
  let bytes = 0
  let truncated = false
  for (const memory of candidates.slice(0, limit)) {
    const item = {
      id: memory.id,
      kind: memory.kind,
      content: memory.content,
      trusted: memory.trusted
    }
    const cost = Buffer.byteLength(JSON.stringify(item), 'utf8')
    if (bytes + cost > maxBytes) {
      truncated = true
      break
    }
    bytes += cost
    results.push(item)
  }
  if (candidates.length > limit) truncated = true
  writeAuditEvent('memory.recall', 'query', 'allow', { results: results.length, bytes })
  return { results, truncated }
}
