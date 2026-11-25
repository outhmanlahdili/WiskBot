import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Full Phase-1 schema. Tables unused until later phases are still created. */
/** Timestamps are epoch milliseconds (number), matching the shared IPC types. */

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  settingsJson: text('settings_json').notNull().default('{}')
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  partsJson: text('parts_json').notNull(),
  createdAt: integer('created_at').notNull(),
  usageJson: text('usage_json')
})

export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  inputJson: text('input_json').notNull(),
  risk: text('risk').notNull(),
  status: text('status').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at')
})

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  toolCallId: text('tool_call_id')
    .notNull()
    .references(() => toolCalls.id, { onDelete: 'cascade' }),
  requestedAt: integer('requested_at').notNull(),
  resolvedAt: integer('resolved_at'),
  approved: integer('approved', { mode: 'boolean' }),
  reason: text('reason')
})

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  baseUrl: text('base_url').notNull(),
  modelId: text('model_id').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  capabilitiesJson: text('capabilities_json').notNull().default('{}')
})

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  source: text('source'),
  confidence: real('confidence').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
})

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  path: text('path').notNull(),
  manifestJson: text('manifest_json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  requiredScopesJson: text('required_scopes_json').notNull().default('[]')
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  scheduleJson: text('schedule_json').notNull(),
  prompt: text('prompt').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at')
})

export const taskRuns = sqliteTable('task_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status').notNull(),
  summary: text('summary'),
  error: text('error')
})

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  ts: integer('ts').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  decision: text('decision').notNull(),
  detailJson: text('detail_json').notNull().default('{}')
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull()
})
