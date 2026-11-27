import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { McpToolDescriptor, Settings } from '../../shared/ipc'
import { z as zod } from 'zod'
import { writeAuditEvent } from '../audit'
import { logger } from '../logger'
import { updateSettings } from '../settings'

export interface McpServerInput {
  name: string
  transport: 'stdio' | 'http'
  target: string
  pinnedVersion?: string
}

export interface McpToolLike {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean }
}

export interface McpClientLike {
  listTools(): Promise<{ tools: McpToolLike[] }>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

export type McpClientFactory = (server: Settings['mcpServers'][number]) => Promise<McpClientLike>

const REJECTED_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'const', 'format', '$ref', 'not', 'if', 'then', 'else']
const WRITE_VERBS = /(write|delete|remove|send|post|purchase|pay|create|update|set|exec|execute|run|install|upload|modify|edit|move|copy|rename|clear)/i

export const SCHEMA_EXAMPLE =
  'Example of an accepted schema: {"type":"object","properties":{"query":{"type":"string"}}}'

export function configHash(input: { transport: string; target: string; pinnedVersion?: string }): string {
  return createHash('sha256')
    .update(JSON.stringify({ transport: input.transport, target: input.target, pinnedVersion: input.pinnedVersion ?? '' }))
    .digest('hex')
    .slice(0, 16)
}

export function flattenMcpSchema(schema: unknown): { ok: true; zod: z.ZodType } | { ok: false; error: string } {
  if (!schema || typeof schema !== 'object') {
    return { ok: false, error: `MCP tool inputSchema must be an object. ${SCHEMA_EXAMPLE}` }
  }
  const root = schema as Record<string, unknown>
  for (const key of REJECTED_KEYWORDS) {
    if (JSON.stringify(root).includes(`"${key}"`)) {
      return { ok: false, error: `Unsupported schema keyword "${key}" in MCP tool. ${SCHEMA_EXAMPLE}` }
    }
  }
  if (root.type !== 'object' || !root.properties || typeof root.properties !== 'object') {
    return { ok: false, error: `MCP tool schema must be a plain object with properties. ${SCHEMA_EXAMPLE}` }
  }

  const shape: Record<string, z.ZodType> = {}
  for (const [key, raw] of Object.entries(root.properties as Record<string, unknown>)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key)) {
      return { ok: false, error: `Invalid MCP property name "${key}". ${SCHEMA_EXAMPLE}` }
    }
    const property = raw as Record<string, unknown>
    const type = property.type
    if (property.enum && Array.isArray(property.enum) && property.enum.every((v) => typeof v === 'string')) {
      shape[key] = z.enum(property.enum as [string, ...string[]])
    } else if (type === 'string') {
      shape[key] = z.string().max(4096)
    } else if (type === 'number' || type === 'integer') {
      shape[key] = z.coerce.number()
    } else if (type === 'boolean') {
      shape[key] = z.coerce.boolean()
    } else {
      return {
        ok: false,
        error: `Unsupported MCP property type "${String(type)}" for "${key}". ${SCHEMA_EXAMPLE}`
      }
    }
  }
  return { ok: true, zod: zod.object(shape).strict() }
}

export function isReadOnlyTool(tool: McpToolLike): boolean {
  if (tool.annotations?.readOnlyHint !== true) return false
  return !WRITE_VERBS.test(tool.name)
}

interface CachedTool {
  descriptor: McpToolDescriptor
  zod: z.ZodType
  server: Settings['mcpServers'][number]
}

let cachedTools: CachedTool[] = []
const unavailable = new Set<string>()

export function getCachedTools(): McpToolDescriptor[] {
  return cachedTools.map((item) => item.descriptor)
}

export function getCachedEntries(): CachedTool[] {
  return cachedTools
}

export function isServerUnavailable(id: string): boolean {
  return unavailable.has(id)
}

async function defaultFactory(server: Settings['mcpServers'][number]): Promise<McpClientLike> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const client = new Client({ name: 'wiskbot', version: '0.1.0' })
  if (server.transport === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    // The target is an explicit command name; never a shell string.
    const [command, ...args] = server.target.split(/\s+/)
    await client.connect(new StdioClientTransport({ command, args, stderr: 'pipe' }))
  } else {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    await client.connect(new StreamableHTTPClientTransport(new URL(server.target)))
  }
  return {
    listTools: async () => {
      const result = await client.listTools()
      return { tools: (result.tools ?? []) as McpToolLike[] }
    },
    callTool: async (name, args) => client.callTool({ name, arguments: args }),
    close: async () => client.close()
  }
}

export function addMcpServer(input: McpServerInput, current: Settings): Settings {
  const id = `mcp_${randomUUID().slice(0, 8)}`
  const server = {
    id,
    name: input.name,
    transport: input.transport,
    target: input.target,
    enabled: false,
    versionHash: configHash(input),
    pinnedVersion: input.pinnedVersion
  }
  const next = updateSettings({ mcpServers: [...current.mcpServers, server] })
  writeAuditEvent('mcp.add', id, 'allow', { transport: input.transport })
  return next
}

export function removeMcpServer(id: string, current: Settings): Settings {
  const next = updateSettings({ mcpServers: current.mcpServers.filter((server) => server.id !== id) })
  cachedTools = cachedTools.filter((tool) => tool.descriptor.serverId !== id)
  unavailable.delete(id)
  writeAuditEvent('mcp.remove', id, 'allow', {})
  return next
}

export function setMcpEnabled(id: string, enabled: boolean, current: Settings): Settings {
  const next = updateSettings({
    mcpServers: current.mcpServers.map((server) =>
      server.id === id ? { ...server, enabled } : server
    )
  })
  if (!enabled) cachedTools = cachedTools.filter((tool) => tool.descriptor.serverId !== id)
  writeAuditEvent('mcp.setEnabled', id, enabled ? 'allow' : 'deny', {})
  return next
}

export async function refreshMcpTools(
  settings: Settings,
  factory: McpClientFactory = defaultFactory
): Promise<{ tools: McpToolDescriptor[]; errors: string[] }> {
  const tools: CachedTool[] = []
  const errors: string[] = []
  for (const server of settings.mcpServers.filter((item) => item.enabled)) {
    let client: McpClientLike | null = null
    try {
      client = await factory(server)
      const listed = await client.listTools()
      for (const tool of listed.tools) {
        if (!isReadOnlyTool(tool)) {
          writeAuditEvent('mcp.tool.refused', `${server.id}.${tool.name}`, 'deny', {
            reason: 'Only read-only tools are allowed in this phase.'
          })
          continue
        }
        const flattened = flattenMcpSchema(tool.inputSchema ?? { type: 'object', properties: {} })
        if (!flattened.ok) {
          errors.push(`${server.name}: ${tool.name}: ${flattened.error}`)
          writeAuditEvent('mcp.schema.refused', `${server.id}.${tool.name}`, 'deny', {
            reason: flattened.error
          })
          continue
        }
        const name = `mcp.${server.id}.${tool.name}`
        tools.push({
          descriptor: {
            name,
            serverId: server.id,
            toolName: tool.name,
            description: `MCP (read-only): ${tool.description ?? tool.name}`,
            readOnly: true,
            versionHash: server.versionHash
          },
          zod: flattened.zod,
          server
        })
      }
      unavailable.delete(server.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      unavailable.add(server.id)
      errors.push(`${server.name}: ${message}`)
      logger.warn('mcp', 'Server unavailable.', { id: server.id, message })
      writeAuditEvent('mcp.unavailable', server.id, 'deny', { error: message })
    } finally {
      await client?.close().catch(() => undefined)
    }
  }
  cachedTools = tools
  return { tools: tools.map((item) => item.descriptor), errors }
}

export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown>,
  settings: Settings,
  factory: McpClientFactory = defaultFactory
): Promise<unknown> {
  const cached = cachedTools.find((tool) => tool.descriptor.name === fullName)
  if (!cached) throw new Error(`MCP tool ${fullName} is not available. Refresh tools first.`)
  const server = settings.mcpServers.find((item) => item.id === cached.descriptor.serverId)
  if (!server || !server.enabled) throw new Error('MCP server is disabled or was removed.')
  if (server.versionHash !== cached.descriptor.versionHash) {
    throw new Error('MCP server configuration changed; refresh tools before calling it.')
  }
  const parsed = cached.zod.parse(args)
  const client = await factory(server)
  try {
    const result = await client.callTool(cached.descriptor.toolName, parsed as Record<string, unknown>)
    writeAuditEvent('mcp.call', fullName, 'allow', {
      serverId: cached.descriptor.serverId,
      keys: Object.keys(parsed as Record<string, unknown>)
    })
    return result
  } finally {
    await client.close().catch(() => undefined)
  }
}
