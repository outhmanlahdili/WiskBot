import { z } from 'zod'

/** Zod-validated messages exchanged with the isolated browser utility process. */

export const BrowserStartSchema = z
  .object({
    type: z.literal('start'),
    userDataDir: z.string().min(1),
    allowedHosts: z.array(z.string()),
    testMode: z.boolean()
  })
  .strict()

export const BrowserCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), requestId: z.string(), url: z.string().min(1).max(4000) }),
  z.object({ type: z.literal('snapshot'), requestId: z.string() }),
  z.object({
    type: z.literal('click'),
    requestId: z.string(),
    selector: z.string().min(1).max(500)
  }),
  z.object({
    type: z.literal('fill'),
    requestId: z.string(),
    selector: z.string().min(1).max(500),
    value: z.string().max(4000)
  }),
  z.object({ type: z.literal('screenshot'), requestId: z.string() }),
  z.object({ type: z.literal('setPaused'), requestId: z.string(), paused: z.boolean() }),
  z.object({ type: z.literal('shutdown'), requestId: z.string() })
])
export type BrowserCommand = z.infer<typeof BrowserCommandSchema>

export const BrowserResultSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional()
})

export const BrowserStatusSchema = z.object({
  type: z.literal('status'),
  status: z.enum(['starting', 'ready', 'busy', 'paused', 'error', 'stopped']),
  url: z.string().optional(),
  message: z.string().optional()
})

export const WorkerMessageSchema = z.discriminatedUnion('type', [
  BrowserResultSchema,
  BrowserStatusSchema
])
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>

export const SNAPSHOT_LIMIT_BYTES = 32 * 1024
