import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { asc, desc, eq } from 'drizzle-orm'
import {
  TaskCreateSchema,
  TaskScheduleSchema,
  TaskUpdateSchema,
  type TaskRecord,
  type TaskRunRecord
} from '../../shared/ipc'
import { writeAuditEvent } from '../audit'
import { getDb, taskRuns, tasks } from '../database'

export const MAX_CATCHUP_MS = 12 * 60 * 60 * 1000

type Row = typeof tasks.$inferSelect

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function computeNextRun(schedule: unknown, fromMs: number): number | null {
  const parsed = TaskScheduleSchema.parse(schedule)
  if (parsed.kind === 'once') return parsed.at > fromMs ? parsed.at : null
  if (parsed.kind === 'interval') return fromMs + parsed.minutes * 60_000
  if (!isValidTimezone(parsed.timezone)) throw new Error(`Invalid IANA timezone: ${parsed.timezone}`)
  // Cron throws for an invalid expression; let the Zod validation report it.
  const cron = new Cron(parsed.expression, { timezone: parsed.timezone })
  return cron.nextRun(new Date(fromMs))?.getTime() ?? null
}

function toRecord(row: Row): TaskRecord {
  return {
    id: row.id,
    kind: row.kind as TaskRecord['kind'],
    prompt: row.prompt,
    schedule: TaskScheduleSchema.parse(JSON.parse(row.scheduleJson)),
    enabled: row.enabled,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt
  }
}

export function listTasks(): TaskRecord[] {
  return getDb()
    .select()
    .from(tasks)
    .orderBy(asc(tasks.nextRunAt))
    .all()
    .map(toRecord)
}

export function getTask(id: string): TaskRecord | null {
  const row = getDb().select().from(tasks).where(eq(tasks.id, id)).get()
  return row ? toRecord(row) : null
}

export function createTask(input: unknown, now = Date.now()): TaskRecord {
  const parsed = TaskCreateSchema.parse(input)
  const schedule = parsed.schedule
  const id = `task_${randomUUID().slice(0, 12)}`
  const nextRunAt = parsed.enabled ? computeNextRun(schedule, now) : null
  getDb()
    .insert(tasks)
    .values({
      id,
      kind: schedule.kind,
      scheduleJson: JSON.stringify(schedule),
      prompt: parsed.prompt,
      enabled: parsed.enabled,
      lastRunAt: null,
      nextRunAt
    })
    .run()
  writeAuditEvent('task.create', id, 'allow', { kind: schedule.kind })
  return getTask(id)!
}

export function updateTask(input: unknown, now = Date.now()): TaskRecord | null {
  const parsed = TaskUpdateSchema.parse(input)
  const current = getTask(parsed.id)
  if (!current) return null
  const schedule = parsed.schedule ?? current.schedule
  const enabled = parsed.enabled ?? current.enabled
  getDb()
    .update(tasks)
    .set({
      kind: schedule.kind,
      scheduleJson: JSON.stringify(schedule),
      prompt: parsed.prompt ?? current.prompt,
      enabled,
      nextRunAt: enabled ? computeNextRun(schedule, now) : null
    })
    .where(eq(tasks.id, parsed.id))
    .run()
  writeAuditEvent('task.update', parsed.id, 'allow', { enabled, kind: schedule.kind })
  return getTask(parsed.id)
}

export function setTaskEnabled(id: string, enabled: boolean, now = Date.now()): TaskRecord | null {
  const current = getTask(id)
  if (!current) return null
  getDb()
    .update(tasks)
    .set({
      enabled,
      nextRunAt: enabled ? computeNextRun(current.schedule, now) : null
    })
    .where(eq(tasks.id, id))
    .run()
  writeAuditEvent('task.setEnabled', id, enabled ? 'allow' : 'deny', {})
  return getTask(id)
}

export function deleteTask(id: string): boolean {
  const current = getTask(id)
  if (!current) return false
  getDb().delete(tasks).where(eq(tasks.id, id)).run()
  writeAuditEvent('task.delete', id, 'allow', { kind: current.kind })
  return true
}

export function recordRunStart(taskId: string, now = Date.now()): void {
  const current = getTask(taskId)
  if (!current) return
  getDb()
    .update(tasks)
    .set({ lastRunAt: now, nextRunAt: current.enabled ? computeNextRun(current.schedule, now) : null })
    .where(eq(tasks.id, taskId))
    .run()
}

export function startTaskRun(taskId: string, now = Date.now()): string {
  const id = `run_${randomUUID().slice(0, 12)}`
  getDb()
    .insert(taskRuns)
    .values({
      id,
      taskId,
      startedAt: now,
      finishedAt: null,
      status: 'running',
      summary: null,
      error: null
    })
    .run()
  writeAuditEvent('task.run.start', taskId, 'allow', { runId: id })
  return id
}

export function finishTaskRun(
  runId: string,
  status: TaskRunRecord['status'],
  summary: string | null,
  error: string | null,
  now = Date.now()
): void {
  getDb()
    .update(taskRuns)
    .set({ status, summary, error, finishedAt: now })
    .where(eq(taskRuns.id, runId))
    .run()
  writeAuditEvent('task.run.finish', runId, status === 'success' ? 'allow' : 'deny', {
    status,
    hasError: Boolean(error)
  })
}

export function listTaskRuns(taskId?: string, limit = 50): TaskRunRecord[] {
  const query = getDb().select().from(taskRuns)
  const rows = taskId
    ? query.where(eq(taskRuns.taskId, taskId)).orderBy(desc(taskRuns.startedAt)).limit(limit).all()
    : query.orderBy(desc(taskRuns.startedAt)).limit(limit).all()
  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status as TaskRunRecord['status'],
    summary: row.summary,
    error: row.error
  }))
}
