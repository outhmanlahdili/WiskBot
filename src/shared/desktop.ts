import { z } from 'zod'

/** Zod-validated messages exchanged with the desktop utility process. */

export const DesktopStartSchema = z
  .object({
    type: z.literal('start'),
    scriptPath: z.string().min(1),
    allowedTitles: z.array(z.string()),
    testMode: z.boolean()
  })
  .strict()

export const DesktopCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('listWindows'), requestId: z.string() }),
  z.object({ type: z.literal('tree'), requestId: z.string(), title: z.string().min(1).max(300) }),
  z.object({ type: z.literal('activate'), requestId: z.string(), title: z.string().min(1).max(300) }),
  z.object({
    type: z.literal('invoke'),
    requestId: z.string(),
    title: z.string().min(1).max(300),
    selector: z.string().min(1).max(300)
  }),
  z.object({
    type: z.literal('clickPoint'),
    requestId: z.string(),
    title: z.string().min(1).max(300),
    x: z.number().int().min(0).max(10000),
    y: z.number().int().min(0).max(10000)
  }),
  z.object({
    type: z.literal('type'),
    requestId: z.string(),
    title: z.string().min(1).max(300),
    selector: z.string().min(1).max(300),
    value: z.string().max(4000)
  }),
  z.object({
    type: z.literal('readText'),
    requestId: z.string(),
    title: z.string().min(1).max(300),
    selector: z.string().min(1).max(300)
  }),
  z.object({
    type: z.literal('screenshot'),
    requestId: z.string(),
    title: z.string().min(1).max(300),
    path: z.string().min(1).max(1000)
  }),
  z.object({ type: z.literal('setPaused'), requestId: z.string(), paused: z.boolean() }),
  z.object({ type: z.literal('shutdown'), requestId: z.string() })
])
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>

export const DesktopResultSchema = z.object({
  type: z.literal('result'),
  requestId: z.string(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional()
})

export const DesktopStatusSchema = z.object({
  type: z.literal('status'),
  status: z.enum(['starting', 'ready', 'busy', 'paused', 'error', 'stopped']),
  title: z.string().optional(),
  message: z.string().optional()
})

export const DesktopWorkerMessageSchema = z.discriminatedUnion('type', [
  DesktopResultSchema,
  DesktopStatusSchema
])
export type DesktopWorkerMessage = z.infer<typeof DesktopWorkerMessageSchema>

export const DESKTOP_TREE_MAX_DEPTH = 5
export const DESKTOP_TREE_MAX_NODES = 120
export const DESKTOP_TEXT_MAX_BYTES = 32 * 1024
