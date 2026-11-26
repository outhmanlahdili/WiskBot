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
    permissionDefaults: PermissionDefaultsSchema,
    /** Absolute filesystem roots the model may list/read (Phase 2). */
    allowedFsRoots: z.array(z.string().min(1)).max(32),
    /** Exact hosts the managed browser may navigate to (Phase 3). */
    browserDomains: z.array(z.string().min(1)).max(64),
    /** Assistant tone used in system instructions (Phase 4). */
    tone: z.enum(['concise', 'friendly', 'formal']),
    /** Exact window titles the desktop worker may control (Phase 5). */
    desktopWindowTitles: z.array(z.string().min(1)).max(32)
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
  'openai-compatible',
  /** Deterministic in-process model for tests and smoke checks; never a real API. */
  'fake'
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

export const ProviderDefinitionPublicSchema = z.object({
  kind: ProviderKindSchema,
  displayName: z.string(),
  defaultBaseUrl: z.string(),
  defaultModelId: z.string(),
  needsKey: z.boolean(),
  availabilityNote: z.string().optional(),
  modelIdPlaceholder: z.string().optional()
})
export type ProviderDefinitionPublic = z.infer<typeof ProviderDefinitionPublicSchema>

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
    if (value.kind === 'fake' && value.baseUrl === 'in-process://fake') return
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

export const MemoryKindSchema = z.enum(['preference', 'fact', 'instruction', 'imported', 'project'])
export type MemoryKind = z.infer<typeof MemoryKindSchema>

export const MemoryUpsertSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
    kind: MemoryKindSchema,
    content: z.string().trim().min(1).max(4096),
    source: z.string().trim().max(120).optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict()

export const MemorySetEnabledSchema = z
  .object({ id: z.string().min(1), enabled: z.boolean() })
  .strict()

export const SkillSetEnabledSchema = z
  .object({ id: z.string().min(1), enabled: z.boolean() })
  .strict()

export const IdPayloadSchema = z.object({ id: z.string().min(1) }).strict()
export const ConversationCreateSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional() })
  .strict()
export const ChatSendSchema = z
  .object({
    conversationId: z.string().min(1),
    providerId: z.string().min(1),
    text: z.string().trim().min(1).max(20000)
  })
  .strict()
export const ChatCancelSchema = z.object({ conversationId: z.string().min(1).optional() }).strict()
export const ApprovalDecisionSchema = z.enum(['allow-once', 'allow-session', 'deny'])
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const ApprovalResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
    decision: ApprovalDecisionSchema,
    reason: z.string().max(500).optional()
  })
  .strict()

/** One event in the streamed chat life-cycle (main -> renderer). */
export const ChatEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('text-delta'),
    conversationId: z.string(),
    delta: z.string()
  }),
  z.object({
    event: z.literal('tool-call'),
    conversationId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.record(z.string(), z.unknown()),
    risk: RiskLevelSchema,
    target: z.string()
  }),
  z.object({
    event: z.literal('tool-result'),
    conversationId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.unknown()
  }),
  z.object({
    event: z.literal('tool-error'),
    conversationId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    message: z.string()
  }),
  z.object({
    event: z.literal('approval-request'),
    conversationId: z.string(),
    approvalId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    risk: RiskLevelSchema,
    target: z.string(),
    scope: z.string(),
    preview: z.string(),
    input: z.unknown(),
    hasSchemaInput: z.boolean(),
    /** null = chat-initiated card that never expires. */
    expiresAt: z.number().nullable()
  }),
  z.object({
    event: z.literal('approval-response'),
    conversationId: z.string(),
    approvalId: z.string(),
    approved: z.boolean(),
    decision: ApprovalDecisionSchema,
    reason: z.string().optional()
  }),
  z.object({
    event: z.literal('usage'),
    conversationId: z.string(),
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number()
  }),
  z.object({
    event: z.literal('done'),
    conversationId: z.string(),
    finishReason: z.string().optional()
  }),
  z.object({
    event: z.literal('error'),
    conversationId: z.string().optional(),
    message: z.string()
  }),
  z.object({
    event: z.literal('browser-status'),
    conversationId: z.string().optional(),
    status: z.enum(['starting', 'ready', 'busy', 'paused', 'error', 'stopped']),
    url: z.string().optional(),
    message: z.string().optional()
  }),
  z.object({
    event: z.literal('browser-takeover'),
    conversationId: z.string().optional(),
    active: z.boolean(),
    message: z.string().optional()
  }),
  z.object({
    event: z.literal('desktop-status'),
    conversationId: z.string().optional(),
    status: z.enum(['starting', 'ready', 'busy', 'paused', 'error', 'stopped']),
    title: z.string().optional(),
    message: z.string().optional()
  }),
  z.object({
    event: z.literal('desktop-takeover'),
    conversationId: z.string().optional(),
    active: z.boolean(),
    message: z.string().optional()
  }),
  z.object({
    event: z.literal('memory-context'),
    conversationId: z.string().optional(),
    entries: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        preview: z.string(),
        trusted: z.boolean()
      })
    )
  })
])
export type ChatEvent = z.infer<typeof ChatEventSchema>
export const AuditListSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict()

/** Every Phase 1 channel has a schema, even where the feature is a later stub. */
export const IpcRequestSchemas = {
  'settings.get': z.void(),
  'settings.update': SettingsUpdateSchema,
  'providers.list': z.void(),
  'providers.definitions': z.void(),
  'providers.upsert': ProviderUpsertSchema,
  'providers.remove': IdPayloadSchema,
  'providers.test': IdPayloadSchema,
  'conversations.list': z.void(),
  'conversations.create': ConversationCreateSchema,
  'conversations.delete': IdPayloadSchema,
  'chat.messages': z.object({ conversationId: z.string().min(1) }).strict(),
  'chat.send': ChatSendSchema,
  'chat.cancel': ChatCancelSchema,
  'chat.respondApproval': ApprovalResponseSchema,
  'tools.list': z.void(),
  'permissions.get': z.void(),
  'audit.list': AuditListSchema,
  'browser.status': z.void(),
  'browser.takeover': z.object({ active: z.boolean() }).strict(),
  'browser.stop': z.void(),
  'browser.restart': z.void(),
  'memory.list': z.void(),
  'memory.upsert': MemoryUpsertSchema,
  'memory.delete': IdPayloadSchema,
  'memory.setEnabled': MemorySetEnabledSchema,
  'skills.list': z.void(),
  'skills.setEnabled': SkillSetEnabledSchema,
  'desktop.status': z.void(),
  'desktop.takeover': z.object({ active: z.boolean() }).strict(),
  'desktop.stop': z.void(),
  'desktop.restart': z.void(),
  'app.deleteLocalData': z.void(),
  'app.resetKeyStore': z.object({ confirmed: z.literal(true) }).strict()
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

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  content: string
  source: string | null
  confidence: number
  createdAt: number
  updatedAt: number
  enabled: boolean
  trusted: boolean
}

export interface SkillRecord {
  id: string
  name: string
  version: string
  description: string
  whenToUse: string
  requiredScopes: string[]
  maxSteps: number
  enabled: boolean
  path: string
}

export interface ChatMessageRecord {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
  usageJson: string | null
}

export interface IpcResultMap {
  'settings.get': Settings
  'settings.update': Settings
  'providers.list': ProviderPublic[]
  'providers.definitions': ProviderDefinitionPublic[]
  'providers.upsert': ProviderPublic
  'providers.remove': { removed: boolean }
  'providers.test': ProviderTestResult
  'conversations.list': Conversation[]
  'conversations.create': Conversation
  'conversations.delete': { removed: boolean }
  'chat.messages': ChatMessageRecord[]
  'chat.send': { accepted: boolean; conversationId: string; reason?: string }
  'chat.cancel': { cancelled: boolean }
  'chat.respondApproval': { recorded: boolean; reason?: string }
  'tools.list': ToolDescriptor[]
  'permissions.get': PermissionDefaults
  'audit.list': AuditEventRecord[]
  'browser.status': {
    status: 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped'
    url?: string
    message?: string
  }
  'browser.takeover': { active: boolean }
  'browser.stop': { stopped: boolean }
  'browser.restart': { restarted: boolean }
  'memory.list': MemoryRecord[]
  'memory.upsert': MemoryRecord
  'memory.delete': { removed: boolean }
  'memory.setEnabled': MemoryRecord
  'skills.list': SkillRecord[]
  'skills.setEnabled': SkillRecord
  'desktop.status': {
    status: 'starting' | 'ready' | 'busy' | 'paused' | 'error' | 'stopped'
    title?: string
    message?: string
  }
  'desktop.takeover': { active: boolean }
  'desktop.stop': { stopped: boolean }
  'desktop.restart': { restarted: boolean }
  'app.deleteLocalData': { deleted: boolean }
  'app.resetKeyStore': { reset: boolean }
}

export const AppEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat.event'),
    event: ChatEventSchema
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
