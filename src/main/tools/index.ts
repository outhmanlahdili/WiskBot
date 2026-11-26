import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ChatEvent, RiskLevel, Settings } from '../../shared/ipc'
import { canonicalizeWithinRoot, isInside } from '../allowlist'
import { writeAuditEvent } from '../audit'
import { hasSessionGrant } from '../permissions'
import { redactSecrets } from '../redaction'

export const MAX_LIST_ENTRIES = 200
export const MAX_READ_BYTES = 64 * 1024

export interface ToolRunContext {
  conversationId: string
  toolCallId: string
  settings: Settings
  ownDirs: string[]
  emit: (event: ChatEvent) => void
  abortSignal?: AbortSignal
}

export type ApprovalKind = 'none' | 'ask-first-target' | 'own-read-auto'

export interface ToolMeta {
  name: string
  risk: RiskLevel
  description: string
  scope: string
  approval: ApprovalKind
  /** Resolved, concrete target used by both the approval card and execute. */
  resolve: (input: Record<string, unknown>, ctx: ToolRunContext) => string
  preview: (input: Record<string, unknown>, target: string) => string
}

const PATH_SCHEMA = z.object({ path: z.string().trim().min(1).max(1000) }).strict()

function resolveReadPath(rawPath: string, ctx: ToolRunContext): string {
  const roots = [...ctx.settings.allowedFsRoots, ...ctx.ownDirs]
  if (roots.length === 0) {
    throw new Error('No folders are allowed. Add an allowed folder in Settings first.')
  }
  let lastReason = 'Path is outside the allowed folders.'
  for (const root of roots) {
    const result = canonicalizeWithinRoot(root, rawPath)
    if (result.ok) return result.path
    lastReason = result.reason
  }
  throw new Error(lastReason)
}

function resolveForMeta(input: Record<string, unknown>, ctx: ToolRunContext): string {
  const raw = input.path
  if (typeof raw !== 'string') return '(invalid path)'
  try {
    return resolveReadPath(raw, ctx)
  } catch (error) {
    return `blocked: ${error instanceof Error ? error.message : String(error)}`
  }
}

function listPreview(_input: Record<string, unknown>, target: string): string {
  return `List up to ${MAX_LIST_ENTRIES} entries in ${target}`
}

function readPreview(_input: Record<string, unknown>, target: string): string {
  return `Read up to ${MAX_READ_BYTES} bytes from ${target} (binary files and detected secrets are redacted)`
}

export const TOOL_META: Record<string, ToolMeta> = {
  'wiskbot.time.now.v1': {
    name: 'wiskbot.time.now.v1',
    risk: 'read',
    description: 'Current local time and timezone',
    scope: 'local clock',
    approval: 'none',
    resolve: () => 'local clock',
    preview: () => 'Read the current local time and timezone. No files or network are accessed.'
  },
  'wiskbot.fs.list.v1': {
    name: 'wiskbot.fs.list.v1',
    risk: 'read',
    description: 'List entries in an allowlisted directory',
    scope: 'allowed filesystem roots',
    approval: 'ask-first-target',
    resolve: resolveForMeta,
    preview: listPreview
  },
  'wiskbot.fs.read.v1': {
    name: 'wiskbot.fs.read.v1',
    risk: 'read',
    description: 'Read a text file in an allowlisted directory',
    scope: 'allowed filesystem roots',
    approval: 'own-read-auto',
    resolve: resolveForMeta,
    preview: readPreview
  }
}

function auditTool(ctx: ToolRunContext, toolName: string, decision: string, input: unknown): void {
  writeAuditEvent(
    'tool.call',
    toolName,
    decision,
    { conversationId: ctx.conversationId, toolCallId: ctx.toolCallId, input }
  )
}

export function createTools(ctx: ToolRunContext): ToolSet {
  const timeNow = tool({
    description: TOOL_META['wiskbot.time.now.v1'].description,
    inputSchema: z.object({}).strict(),
    execute: async () => {
      const now = new Date()
      auditTool(ctx, 'wiskbot.time.now.v1', 'allow', {})
      return { iso: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    }
  })

  const fsList = tool({
    description: TOOL_META['wiskbot.fs.list.v1'].description,
    inputSchema: PATH_SCHEMA,
    execute: async ({ path }) => {
      // Re-check the resolved target inside execute, not just in the policy.
      const resolved = resolveReadPath(path, ctx)
      const stats = statSync(resolved)
      if (!stats.isDirectory()) throw new Error('Target is not a directory.')
      const names = readdirSync(resolved, { withFileTypes: true })
      const entries = names.slice(0, MAX_LIST_ENTRIES).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : 'file'
      }))
      const result = { entries, count: entries.length, truncated: names.length > MAX_LIST_ENTRIES }
      auditTool(ctx, 'wiskbot.fs.list.v1', 'allow', { path: resolved })
      return result
    }
  })

  const fsRead = tool({
    description: TOOL_META['wiskbot.fs.read.v1'].description,
    inputSchema: PATH_SCHEMA,
    execute: async ({ path }) => {
      const resolved = resolveReadPath(path, ctx)
      const stats = statSync(resolved)
      if (!stats.isFile()) throw new Error('Target is not a file.')
      if (stats.size > MAX_READ_BYTES) {
        return {
          content: '',
          truncated: true,
          reason: `File exceeds the ${MAX_READ_BYTES} byte limit.`
        }
      }
      const buffer = readFileSync(resolved)
      const isBinary = buffer.includes(0)
      if (isBinary) return { content: '', truncated: false, reason: 'Binary file; not read.' }
      const content = redactSecrets(buffer.toString('utf8'))
      auditTool(ctx, 'wiskbot.fs.read.v1', 'allow', { path: resolved })
      return { content, truncated: false }
    }
  })

  return {
    'wiskbot.time.now.v1': timeNow,
    'wiskbot.fs.list.v1': fsList,
    'wiskbot.fs.read.v1': fsRead
  }
}

/** The single tool-approval policy entry point used by agent-approval rules. */
export function toolNeedsApproval(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolRunContext
): { status: 'auto-approved' | 'auto-denied' | 'user-approval'; reason: string; target: string; scope: string; preview: string } {
  const meta = TOOL_META[toolName]
  if (!meta) {
    return {
      status: 'auto-denied',
      reason: `Unknown tool: ${toolName}`,
      target: '(unknown)',
      scope: 'none',
      preview: ''
    }
  }
  const target = meta.resolve(input, ctx)
  const base = { target, scope: meta.scope, preview: meta.preview(input, target) }

  if (target.startsWith('blocked:')) {
    return { status: 'auto-denied', reason: target.slice('blocked: '.length), ...base }
  }

  switch (meta.approval) {
    case 'none':
      return { status: 'auto-approved', reason: 'Low-risk, no scope required.', ...base }
    case 'own-read-auto': {
      const own = typeof input.path === 'string' && ctx.ownDirs.some((dir) => isInside(dir, target))
      if (own) {
        return { status: 'auto-approved', reason: 'Plain read inside WiskBot folders.', ...base }
      }
      break
    }
    case 'ask-first-target':
      break
  }

  if (hasSessionGrant(ctx.conversationId, toolName, target)) {
    return { status: 'auto-approved', reason: 'Allowed for this session.', ...base }
  }
  return { status: 'user-approval', reason: meta.description, ...base }
}

export function newToolCallId(): string {
  return `tc_${randomUUID().slice(0, 12)}`
}

export { join }
