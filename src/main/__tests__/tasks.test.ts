import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatEvent, Settings } from '../../shared/ipc'
import { createFakeModel } from '../fake-provider'
import { closeDatabase, getDb, useDatabaseForTests } from '../database'
import * as schema from '../database/schema'
import { createTaskExecutor, TEST_RUN_TOOLS } from '../tasks/executor'
import {
  computeNextRun,
  createTask,
  getTask,
  isValidTimezone,
  listTaskRuns,
  listTasks,
  setTaskEnabled,
  updateTask
} from '../tasks/service'
import { TaskScheduler, type TaskRunOutcome, type TaskSchedulerEvent } from '../tasks/scheduler'

let dir: string
let clock: number
let settings: Settings
const now = () => clock

beforeEach(() => {
  clock = Date.UTC(2026, 10, 27, 12, 0, 0)
  dir = mkdtempSync(join(tmpdir(), 'wiskbot-tasks-test-'))
  const sqlite = new Database(join(dir, 'test.db'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
  useDatabaseForTests(db, sqlite)
  settings = {
    language: 'en',
    permissionDefaults: {
      read: 'allow-once',
      write: 'ask',
      external: 'ask',
      destructive: 'ask'
    },
    allowedFsRoots: [],
    browserDomains: [],
    tone: 'concise',
    desktopWindowTitles: ['Untitled - Notepad'],
    keepAwakeForTasks: true
  }
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('schedules', () => {
  it('parses cron with an explicit IANA timezone', () => {
    expect(isValidTimezone('Africa/Casablanca')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(() =>
      computeNextRun({ kind: 'cron', expression: 'not a cron', timezone: 'UTC' }, now())
    ).toThrow()
    const next = computeNextRun({ kind: 'cron', expression: '0 * * * *', timezone: 'Africa/Casablanca' }, now())
    expect(next).not.toBeNull()
    expect(next!).toBeGreaterThan(now())
  })

  it('computes one-shot and interval schedules', () => {
    expect(computeNextRun({ kind: 'once', at: now() + 5000 }, now())).toBe(now() + 5000)
    expect(computeNextRun({ kind: 'once', at: now() - 1 }, now())).toBeNull()
    expect(computeNextRun({ kind: 'interval', minutes: 5 }, now())).toBe(now() + 5 * 60_000)
  })

  it('creates, updates and disables tasks', () => {
    const task = createTask({ prompt: 'Check the weather', schedule: { kind: 'interval', minutes: 10 } }, now())
    expect(task.kind).toBe('interval')
    expect(task.nextRunAt).toBe(now() + 10 * 60_000)
    const disabled = setTaskEnabled(task.id, false, now())
    expect(disabled?.enabled).toBe(false)
    expect(disabled?.nextRunAt).toBeNull()
    const updated = updateTask({ id: task.id, prompt: 'Check again' }, now())
    expect(updated?.prompt).toBe('Check again')
    expect(listTasks()).toHaveLength(1)
  })
})

describe('scheduler safety', () => {
  it('dispatches a one-shot task only once it is due', async () => {
    createTask({ prompt: 'Run once', schedule: { kind: 'once', at: clock + 1000 } }, now())
    let calls = 0
    const scheduler = new TaskScheduler({
      now,
      execute: async () => {
        calls++
        return { status: 'success', summary: 'done', error: null }
      },
      onEvent: () => undefined
    })
    scheduler.tick()
    expect(calls).toBe(0)
    clock += 1001
    await Promise.resolve()
    scheduler.tick()
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(listTaskRuns().length).toBeGreaterThanOrEqual(1)
  })

  it('prevents overlapping runs', async () => {
    createTask({ prompt: 'Long task', schedule: { kind: 'interval', minutes: 1 } }, now())
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    clock += 60_000
    let calls = 0
    const scheduler = new TaskScheduler({
      now,
      execute: async () => {
        calls++
        await gate
        return { status: 'success', summary: 'done', error: null }
      },
      onEvent: () => undefined
    })
    scheduler.tick()
    await Promise.resolve()
    scheduler.tick()
    expect(calls).toBe(1)
    release()
  })

  it('marks runs more than 12 hours late as missed', () => {
    const task = createTask({ prompt: 'Late', schedule: { kind: 'interval', minutes: 1 } }, now())
    getDb()
      .update(schema.tasks)
      .set({ nextRunAt: now() - (13 * 60 * 60 * 1000) })
      .where(eq(schema.tasks.id, task.id))
      .run()
    const events: TaskSchedulerEvent[] = []
    let calls = 0
    const scheduler = new TaskScheduler({
      now,
      execute: async () => {
        calls++
        return { status: 'success', summary: 'done', error: null }
      },
      onEvent: (event) => events.push(event)
    })
    scheduler.tick()
    expect(calls).toBe(0)
    expect(events.some((event) => event.type === 'missed')).toBe(true)
    clock += 60_000
  })

  it('enforces concurrency and hourly rate limits', async () => {
    const first = createTask({ prompt: 'A', schedule: { kind: 'interval', minutes: 1 } }, now())
    createTask({ prompt: 'B', schedule: { kind: 'interval', minutes: 1 } }, now())
    const events: TaskSchedulerEvent[] = []
    clock += 60_000
    const scheduler = new TaskScheduler({
      now,
      maxConcurrent: 1,
      execute: async () => new Promise<TaskRunOutcome>(() => undefined),
      onEvent: (event) => events.push(event)
    })
    scheduler.tick()
    await Promise.resolve()
    expect(events.filter((event) => event.type === 'started')).toHaveLength(1)
    expect(events.some((event) => event.type === 'queued')).toBe(true)

    const limitedTask = createTask(
      { prompt: 'Rate limited', schedule: { kind: 'interval', minutes: 1 } },
      now()
    )
    clock += 60_000
    const limited = new TaskScheduler({
      now,
      maxRunsPerHour: 1,
      execute: async () => ({ status: 'success', summary: 'done', error: null }),
      onEvent: () => undefined
    })
    expect(limited.canDispatch(limitedTask.id, now())).toBe(true)
    limited.tick()
    await Promise.resolve()
    expect(limited.canDispatch(limitedTask.id, now())).toBe(false)
    expect(first.enabled).toBe(true)
  })
})

describe('task execution', () => {
  function makeExecutor(overrides: Partial<Parameters<typeof createTaskExecutor>[0]> = {}) {
    return createTaskExecutor({
      now,
      settings,
      userDataDir: dir,
      model: createFakeModel({ getRoot: () => dir }),
      emit: () => undefined,
      keepAwake: { start: () => 1, stop: () => undefined },
      ...overrides
    })
  }

  it('restricts test runs to read-only tools', async () => {
    expect(TEST_RUN_TOOLS).not.toContain('wiskbot.desktop.type.v1')
    expect(TEST_RUN_TOOLS).not.toContain('wiskbot.fs.write.v1')
    expect(TEST_RUN_TOOLS).toContain('wiskbot.fs.read.v1')

    const task = createTask({ prompt: 'desktop type', schedule: { kind: 'once', at: now() + 1000 } }, now())
    await makeExecutor().execute({ task, runId: 'run_test_readonly', test: true })
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'tool.call' && row.target === 'wiskbot.desktop.type.v1')).toBe(false)
  })

  it('pairs keep-awake start and stop', async () => {
    const task = createTask({ prompt: 'hello', schedule: { kind: 'once', at: now() + 1000 } }, now())
    const events: ChatEvent[] = []
    let started = 0
    let stopped = 0
    const executor = makeExecutor({
      emit: (event) => events.push(event),
      keepAwake: {
        start: () => { started++; return 7 },
        stop: (id) => { expect(id).toBe(7); stopped++ }
      }
    })
    const outcome = await executor.execute({ task, runId: 'run_keep_awake', test: false })
    expect(outcome.status).toBe('success')
    expect(started).toBe(1)
    expect(stopped).toBe(1)
    expect(events.filter((event) => event.event === 'keep-awake' && event.active)).toHaveLength(1)
    expect(events.filter((event) => event.event === 'keep-awake' && !event.active)).toHaveLength(1)
  })

  it('times out an unanswered approval without silently approving', async () => {
    const task = createTask({ prompt: 'desktop click', schedule: { kind: 'once', at: now() + 1000 } }, now())
    let recordedDelay = 0
    const executor = makeExecutor({
      setApprovalTimer: (fn, ms) => {
        recordedDelay = ms
        fn()
        return setTimeout(() => undefined, 0)
      }
    })
    const outcome = await executor.execute({ task, runId: 'run_timeout', test: false })
    expect(recordedDelay).toBe(30 * 60 * 1000)
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toBe('nobody answered the approval')
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'task.approval.timeout')).toBe(true)
  })

  it('schedules a retry when the provider is offline', async () => {
    const task = createTask({ prompt: 'offline', schedule: { kind: 'once', at: now() + 1000 } }, now())
    let nextRunAt: number | null = null
    const executor = makeExecutor({
      setNextRun: (_id, value) => { nextRunAt = value }
    })
    const outcome = await executor.execute({ task, runId: 'run_offline', test: false })
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toMatch(/^offline:/)
    expect(nextRunAt).toBe(now() + 60_000)
    expect(getTask(task.id)?.enabled).toBe(true)
  })

  it('creates an audit record for task writes', () => {
    const task = createTask({ prompt: 'Audit me', schedule: { kind: 'interval', minutes: 2 } }, now())
    const audits = getDb().select().from(schema.auditEvents).all()
    expect(audits.some((row) => row.action === 'task.create' && row.target === task.id)).toBe(true)
  })
})
