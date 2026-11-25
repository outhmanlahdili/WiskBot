import { z } from 'zod'

/** Shared, validated contracts between the preload bridge and the main process. */

export const LanguageSchema = z.enum(['en', 'fr', 'ar'])
export type Language = z.infer<typeof LanguageSchema>

export const PermissionModeSchema = z.enum([
  'deny',
  'ask',
  'allow-once',
  'allow-session',
  'allow-always'
])
export type PermissionMode = z.infer<typeof PermissionModeSchema>

export const RiskLevelSchema = z.enum(['read', 'write', 'external', 'destructive', 'privileged'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const PermissionDefaultsSchema = z.object({
  read: PermissionModeSchema,
  write: PermissionModeSchema,
  external: PermissionModeSchema,
  destructive: PermissionModeSchema
})
export type PermissionDefaults = z.infer<typeof PermissionDefaultsSchema>

export const SettingsSchema = z
  .object({
    language: LanguageSchema,
    permissionDefaults: PermissionDefaultsSchema
  })
  .strict()
export type Settings = z.infer<typeof SettingsSchema>

export const SettingsUpdateSchema = SettingsSchema.partial().strict()

export const ProviderKindSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'groq',
  'mistral',
  'deepseek',
  'openrouter',
  'meta-muse',
  'ollama',
  'openai-compatible'
])
export type ProviderKind = z.infer<typeof ProviderKindSchema>

export const ProviderCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  tools: z.boolean(),
  responses: z.boolean().optional(),
  reasoning: z.boolean().optional()
})
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>

export const ProviderPublicSchema = z.object({
  id: z.string(),
  kind: ProviderKindSchema,
  displayName: z.string(),
  baseUrl: z.string(),
  modelId: z.string(),
  enabled: z.boolean(),
  capabilities: ProviderCapabilitiesSchema,
  hasKey: z.boolean(),
  keyHint: z.string(),
  availabilityNote: z.string().optional()
})
export type ProviderPublic = z.infer<typeof ProviderPublicSchema>

/**
 * `apiKey` is the ONLY field that carries a secret, and it only ever travels
 * renderer -> main. It is never included in any result or event.
 */
export const ProviderUpsertSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/, 'id may contain only lowercase letters, digits, _ and -')
      .optional(),
    kind: ProviderKindSchema,
    displayName: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().min(1).max(500),
    modelId: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    apiKey: z.string().max(4096).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value.baseUrl)
      const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Base URL must use HTTPS, or HTTP for a local endpoint'
        })
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Base URL must be a valid URL' })
    }
  })
export type ProviderUpsert = z.input<typeof ProviderUpsertSchema>

export const IdPayloadSchema = z.object({ id: z.string().min(1) }).strict()
export const ConversationCreateSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional() })
  .strict()
export const ChatSendSchema = z
  .object({
    conversationId: z.string().min(1),
    text: z.string().trim().min(1).max(20000)
  })
  .strict()
export const ChatCancelSchema = z.object({ conversationId: z.string().min(1).optional() }).strict()
export const ApprovalResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().max(500).optional()
  })
  .strict()
export const AuditListSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict()

/** Every Phase 1 channel has a schema, even where the feature is a later stub. */
export const IpcRequestSchemas = {
  'settings.get': z.void(),
  'settings.update': SettingsUpdateSchema,
  'providers.list': z.void(),
  'providers.upsert': ProviderUpsertSchema,
  'providers.remove': IdPayloadSchema,
  'providers.test': IdPayloadSchema,
  'conversations.list': z.void(),
  'conversations.create': ConversationCreateSchema,
  'conversations.delete': IdPayloadSchema,
  'chat.send': ChatSendSchema,
  'chat.cancel': ChatCancelSchema,
  'chat.respondApproval': ApprovalResponseSchema,
  'tools.list': z.void(),
  'permissions.get': z.void(),
  'audit.list': AuditListSchema,
  'app.deleteLocalData': z.void()
} as const satisfies Record<string, z.ZodType>

export type IpcChannel = keyof typeof IpcRequestSchemas
export type IpcRequest<C extends IpcChannel> = z.input<(typeof IpcRequestSchemas)[C]>

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ToolDescriptor {
  name: string
  risk: RiskLevel
  description: string
  approval: PermissionMode
}

export interface AuditEventRecord {
  id: string
  ts: number
  actor: string
  action: string
  target: string
  decision: string
  detailJson: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export interface IpcResultMap {
  'settings.get': Settings
  'settings.update': Settings
  'providers.list': ProviderPublic[]
  'providers.upsert': ProviderPublic
  'providers.remove': { removed: boolean }
  'providers.test': ProviderTestResult
  'conversations.list': Conversation[]
  'conversations.create': Conversation
  'conversations.delete': { removed: boolean }
  'chat.send': { accepted: boolean; conversationId: string; reason?: string }
  'chat.cancel': { cancelled: boolean }
  'chat.respondApproval': { recorded: boolean; reason?: string }
  'tools.list': ToolDescriptor[]
  'permissions.get': PermissionDefaults
  'audit.list': AuditEventRecord[]
  'app.deleteLocalData': { deleted: boolean }
}

export const AppEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat.event'),
    conversationId: z.string(),
    event: z.enum(['text-delta', 'tool-call', 'approval-request', 'tool-result', 'error', 'usage']),
    data: z.unknown().optional()
  }),
  z.object({
    type: z.literal('task.event'),
    taskId: z.string().optional(),
    event: z.string(),
    data: z.unknown().optional()
  }),
  z.object({
    type: z.literal('permission.changed'),
    scope: z.string().optional()
  }),
  z.object({
    type: z.literal('provider.event'),
    providerId: z.string(),
    event: z.enum(['saved', 'removed', 'tested']),
    ok: z.boolean(),
    message: z.string().optional()
  }),
  z.object({
    type: z.literal('app.error'),
    message: z.string(),
    code: z.string().optional()
  })
])
export type AppEvent = z.infer<typeof AppEventSchema>

export interface WiskBotBridge {
  send<C extends IpcChannel>(
    channel: C,
    ...args: [IpcRequest<C>] extends [void] ? [] : [payload: IpcRequest<C>]
  ): Promise<IpcResultMap[C]>
  onEvent(handler: (event: AppEvent) => void): () => void
}

export const APP_EVENT_CHANNEL = 'wiskbot.event'
