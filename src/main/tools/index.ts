import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ChatEvent, RiskLevel, Settings } from '../../shared/ipc'
import { SNAPSHOT_LIMIT_BYTES } from '../../shared/browser'
import { canonicalizeWithinRoot, isInside, resolveBrowserUrl } from '../allowlist'
import { writeAuditEvent } from '../audit'
import type { BrowserControl } from '../browser-worker/manager'
import { recallMemories, saveMemory } from '../memory'
import { hasSessionGrant } from '../permissions'
import { redactSecrets } from '../redaction'
import { invokeSkill } from '../skills'

export const MAX_LIST_ENTRIES = 200
export const MAX_READ_BYTES = 64 * 1024
export const MAX_SNAPSHOT_BYTES = SNAPSHOT_LIMIT_BYTES

export interface ToolRunContext {
  conversationId: string
  toolCallId: string
  settings: Settings
  ownDirs: string[]
  emit: (event: ChatEvent) => void
  abortSignal?: AbortSignal
  /** Injected by main; absent in unit tests that do not exercise browser tools. */
  browser?: BrowserControl
  /** Base user-data dir for skill files; defaults to the real profile in main. */
  skillsDir?: string
}

export type ApprovalKind =
  | 'none'
  | 'ask-first-target'
  | 'own-read-auto'
  | 'browser-open'
  | 'browser-read'
  | 'browser-write'
  | 'browser-type'
  | 'browser-screenshot'
  | 'memory-write'
  | 'memory-read'
  | 'skill-invoke'

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
const URL_SCHEMA = z.object({ url: z.string().trim().min(1).max(4000) }).strict()
const LOCATOR_SCHEMA = z.object({ selector: z.string().trim().min(1).max(500) }).strict()
const FILL_SCHEMA = z
  .object({
    selector: z.string().trim().min(1).max(500),
    value: z.string().max(4000)
  })
  .strict()
const MEMORY_SAVE_TOOL_SCHEMA = z
  .object({
    kind: z.enum(['preference', 'fact', 'instruction', 'imported', 'project']),
    content: z.string().trim().min(1).max(4096)
  })
  .strict()
const MEMORY_RECALL_TOOL_SCHEMA = z
  .object({
    /** Empty string recalls all enabled memories. */
    query: z.string().trim().max(200),
    limit: z.number().int().min(1).max(8).optional().default(8)
  })
  .strict()
const SKILL_INVOKE_SCHEMA = z
  .object({ skillId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) })
  .strict()

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

function browserHost(ctx: ToolRunContext): string {
  const url = ctx.browser?.getStatus().url
  if (!url) return '(no page)'
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return '(no page)'
  }
}

function resolveBrowserMeta(input: Record<string, unknown>, ctx: ToolRunContext): string {
  if (typeof input.url !== 'string') return browserHost(ctx)
  const result = resolveBrowserUrl(input.url, ctx.settings.browserDomains)
  if (!result.ok) return `blocked: ${result.reason}`
  return result.host
}

function listPreview(_input: Record<string, unknown>, target: string): string {
  return `List up to ${MAX_LIST_ENTRIES} entries in ${target}`
}

function readPreview(_input: Record<string, unknown>, target: string): string {
  return `Read up to ${MAX_READ_BYTES} bytes from ${target} (binary files and detected secrets are redacted)`
}

function browserOpenPreview(input: Record<string, unknown>, target: string): string {
  return `Open ${String(input.url ?? '')} in the visible managed browser (host: ${target}). No user profile is used.`
}

function browserSnapshotPreview(_input: Record<string, unknown>, target: string): string {
  return `Read a bounded, untrusted accessibility/text snapshot of the managed tab (${target}).`
}

function browserClickPreview(input: Record<string, unknown>, target: string): string {
  return `Click the single element matching ${String(input.selector ?? '')} in ${target}.`
}

function browserTypePreview(input: Record<string, unknown>, target: string): string {
  const selector = String(input.selector ?? '')
  if (looksLikeSecretSelector(selector)) {
    return `Fill ${selector} in ${target}. Value is hidden; enter it yourself with Take over.`
  }
  const value = String(input.value ?? '')
  const preview = value.length > 60 ? `${value.slice(0, 60)}…` : value
  return `Fill ${selector} in ${target} with: ${preview}`
}

function browserScreenshotPreview(_input: Record<string, unknown>, target: string): string {
  return `Capture a screenshot of the managed tab (${target}); saved locally, no image sent to the model.`
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
  },
  'wiskbot.browser.open.v1': {
    name: 'wiskbot.browser.open.v1',
    risk: 'external',
    description: 'Open an allowlisted URL in the managed browser',
    scope: 'managed browser domain allowlist',
    approval: 'browser-open',
    resolve: resolveBrowserMeta,
    preview: browserOpenPreview
  },
  'wiskbot.browser.snapshot.v1': {
    name: 'wiskbot.browser.snapshot.v1',
    risk: 'read',
    description: 'Read a bounded, untrusted snapshot of the managed tab',
    scope: 'managed browser active tab',
    approval: 'browser-read',
    resolve: (_input, ctx) => browserHost(ctx),
    preview: browserSnapshotPreview
  },
  'wiskbot.browser.click.v1': {
    name: 'wiskbot.browser.click.v1',
    risk: 'write',
    description: 'Click one resolved locator in the managed tab',
    scope: 'managed browser active tab',
    approval: 'browser-write',
    resolve: (_input, ctx) => browserHost(ctx),
    preview: browserClickPreview
  },
  'wiskbot.browser.type.v1': {
    name: 'wiskbot.browser.type.v1',
    risk: 'write',
    description: 'Fill a non-secret field in the managed tab',
    scope: 'managed browser active tab',
    approval: 'browser-type',
    resolve: (_input, ctx) => browserHost(ctx),
    preview: browserTypePreview
  },
  'wiskbot.browser.screenshot.v1': {
    name: 'wiskbot.browser.screenshot.v1',
    risk: 'read',
    description: 'Save a screenshot of the managed tab locally',
    scope: 'managed browser active tab',
    approval: 'browser-screenshot',
    resolve: (_input, ctx) => browserHost(ctx),
    preview: browserScreenshotPreview
  },
  'wiskbot.memory.save.v1': {
    name: 'wiskbot.memory.save.v1',
    risk: 'write',
    description: 'Save a user preference or fact',
    scope: 'user memory (local only)',
    approval: 'memory-write',
    resolve: (input) => String(input.kind ?? 'memory'),
    preview: (input) => `Save a ${String(input.kind ?? 'memory')} in local memory (source: chat).`
  },
  'wiskbot.memory.recall.v1': {
    name: 'wiskbot.memory.recall.v1',
    risk: 'read',
    description: 'Search enabled user memories',
    scope: 'enabled user memories',
    approval: 'memory-read',
    resolve: () => 'enabled memories',
    preview: (input) => `Search enabled memories for: ${String(input.query ?? '(all)')}`
  },
  'wiskbot.skill.invoke.v1': {
    name: 'wiskbot.skill.invoke.v1',
    risk: 'external',
    description: 'Load a local skill\'s instructions for the agent to follow',
    scope: 'local skills (Markdown only)',
    approval: 'skill-invoke',
    resolve: (input) => {
      const id = String(input.skillId ?? '')
      return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : 'blocked: invalid skill id'
    },
    preview: (_input, target) =>
      `Load the Markdown instructions of skill ${target}. No scripts are executed.`
  }
}

function auditTool(ctx: ToolRunContext, toolName: string, decision: string, input: unknown): void {
  writeAuditEvent('tool.call', toolName, decision, {
    conversationId: ctx.conversationId,
    toolCallId: ctx.toolCallId,
    input
  })
}

async function requireBrowser(ctx: ToolRunContext): Promise<BrowserControl> {
  if (!ctx.browser) {
    throw new Error('The managed browser is not available. Restart it from Settings.')
  }
  await ctx.browser.waitUntilReady()
  return ctx.browser
}

async function requireAllowedCurrentPage(ctx: ToolRunContext): Promise<string> {
  const browser = await requireBrowser(ctx)
  const result = resolveBrowserUrl(browser.getStatus().url ?? '', ctx.settings.browserDomains)
  if (!result.ok) throw new Error(result.reason)
  return result.url
}

export function looksLikeSecretSelector(selector: string): boolean {
  return /(password|passphrase|secret|token|api[-_ ]?key|cvv|card.?number|\botp\b|\bpin\b)/i.test(
    selector
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
        return { content: '', truncated: true, reason: `File exceeds the ${MAX_READ_BYTES} byte limit.` }
      }
      const buffer = readFileSync(resolved)
      if (buffer.includes(0)) return { content: '', truncated: false, reason: 'Binary file; not read.' }
      const content = redactSecrets(buffer.toString('utf8'))
      auditTool(ctx, 'wiskbot.fs.read.v1', 'allow', { path: resolved })
      return { content, truncated: false }
    }
  })

  const browserOpen = tool({
    description: TOOL_META['wiskbot.browser.open.v1'].description,
    inputSchema: URL_SCHEMA,
    execute: async ({ url }) => {
      // Re-validate the concrete target in execute, not just in the policy.
      const resolved = resolveBrowserUrl(url, ctx.settings.browserDomains)
      if (!resolved.ok) throw new Error(resolved.reason)
      const browser = await requireBrowser(ctx)
      const result = await browser.open(resolved.url)
      const finalCheck = resolveBrowserUrl(result.url, ctx.settings.browserDomains)
      if (!finalCheck.ok) throw new Error(`Final URL was blocked: ${finalCheck.reason}`)
      auditTool(ctx, 'wiskbot.browser.open.v1', 'allow', { host: resolved.host })
      return { url: result.url, title: result.title, host: resolved.host }
    }
  })

  const browserSnapshot = tool({
    description: TOOL_META['wiskbot.browser.snapshot.v1'].description,
    inputSchema: z.object({}).strict(),
    execute: async () => {
      await requireAllowedCurrentPage(ctx)
      const browser = await requireBrowser(ctx)
      const result = await browser.snapshot()
      const text = result.text.slice(0, MAX_SNAPSHOT_BYTES)
      auditTool(ctx, 'wiskbot.browser.snapshot.v1', 'allow', { bytes: Buffer.byteLength(text, 'utf8') })
      return {
        untrustedPageContent: true,
        url: result.url,
        text,
        truncated: result.truncated || text.length < result.text.length
      }
    }
  })

  const browserClick = tool({
    description: TOOL_META['wiskbot.browser.click.v1'].description,
    inputSchema: LOCATOR_SCHEMA,
    execute: async ({ selector }) => {
      await requireAllowedCurrentPage(ctx)
      const browser = await requireBrowser(ctx)
      const result = await browser.click(selector)
      auditTool(ctx, 'wiskbot.browser.click.v1', 'allow', { selector })
      return result
    }
  })

  const browserType = tool({
    description: TOOL_META['wiskbot.browser.type.v1'].description,
    inputSchema: FILL_SCHEMA,
    execute: async ({ selector, value }) => {
      await requireAllowedCurrentPage(ctx)
      if (looksLikeSecretSelector(selector)) {
        return {
          refused: true,
          reason: 'This looks like a secret field. Enter it yourself with Take over; the assistant will not type secrets.'
        }
      }
      const browser = await requireBrowser(ctx)
      try {
        const result = await browser.fill(selector, value)
        auditTool(ctx, 'wiskbot.browser.type.v1', 'allow', { selector, valueLength: value.length })
        return result
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        auditTool(ctx, 'wiskbot.browser.type.v1', 'deny', { selector, reason })
        return { refused: true, reason }
      }
    }
  })

  const browserScreenshot = tool({
    description: TOOL_META['wiskbot.browser.screenshot.v1'].description,
    inputSchema: z.object({}).strict(),
    execute: async () => {
      await requireAllowedCurrentPage(ctx)
      const browser = await requireBrowser(ctx)
      const result = await browser.screenshot()
      auditTool(ctx, 'wiskbot.browser.screenshot.v1', 'allow', {
        path: result.path,
        bytes: result.bytes
      })
      return { path: result.path, bytes: result.bytes, url: result.url }
    }
  })

  const memorySave = tool({
    description: TOOL_META['wiskbot.memory.save.v1'].description,
    inputSchema: MEMORY_SAVE_TOOL_SCHEMA,
    execute: async ({ kind, content }) => {
      const record = saveMemory({ kind, content, source: 'chat' })
      auditTool(ctx, 'wiskbot.memory.save.v1', 'allow', { id: record.id, kind })
      return { id: record.id, kind: record.kind, saved: true }
    }
  })

  const memoryRecall = tool({
    description: TOOL_META['wiskbot.memory.recall.v1'].description,
    inputSchema: MEMORY_RECALL_TOOL_SCHEMA,
    execute: async ({ query, limit }) => {
      const result = recallMemories(query, limit)
      auditTool(ctx, 'wiskbot.memory.recall.v1', 'allow', {
        query: query ?? '',
        results: result.results.length
      })
      return {
        untrustedMemoryContent: true,
        results: result.results,
        truncated: result.truncated
      }
    }
  })

  const skillInvoke = tool({
    description: TOOL_META['wiskbot.skill.invoke.v1'].description,
    inputSchema: SKILL_INVOKE_SCHEMA,
    execute: async ({ skillId }) => {
      // Re-validate the concrete target and declared scopes inside execute.
      const skill = invokeSkill(skillId, Object.keys(TOOL_META), ctx.skillsDir)
      auditTool(ctx, 'wiskbot.skill.invoke.v1', 'allow', { skillId, version: skill.version })
      return {
        untrustedSkillInstructions: true,
        name: skill.name,
        version: skill.version,
        instructions: skill.instructions
      }
    }
  })

  return {
    'wiskbot.time.now.v1': timeNow,
    'wiskbot.fs.list.v1': fsList,
    'wiskbot.fs.read.v1': fsRead,
    'wiskbot.browser.open.v1': browserOpen,
    'wiskbot.browser.snapshot.v1': browserSnapshot,
    'wiskbot.browser.click.v1': browserClick,
    'wiskbot.browser.type.v1': browserType,
    'wiskbot.browser.screenshot.v1': browserScreenshot,
    'wiskbot.memory.save.v1': memorySave,
    'wiskbot.memory.recall.v1': memoryRecall,
    'wiskbot.skill.invoke.v1': skillInvoke
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
    case 'browser-read': {
      if (target !== '(no page)' && hasSessionGrant(ctx.conversationId, 'wiskbot.browser.open.v1', target)) {
        return { status: 'auto-approved', reason: 'Reading an already-granted domain.', ...base }
      }
      break
    }
    case 'memory-read':
      return { status: 'auto-approved', reason: 'Enabled memories are low-risk local data.', ...base }
    case 'memory-write':
      return { status: 'user-approval', reason: 'Saving a memory requires approval.', ...base }
    case 'browser-type':
      // Always ask. A secret-looking selector is refused inside execute.
      break
    case 'browser-open':
    case 'browser-write':
    case 'browser-screenshot':
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
