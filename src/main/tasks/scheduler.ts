import { eq } from 'drizzle-orm'
import type { TaskRecord, TaskRunRecord } from '../../shared/ipc'
import { getDb, tasks } from '../database'
import {
  computeNextRun,
  finishTaskRun,
  getTask,
  listTasks,
  recordRunStart,
  startTaskRun,
  MAX_CATCHUP_MS
} from './service'

export interface TaskRunRequest {
  task: TaskRecord
  runId: string
  /** Test runs must not perform write/external actions. */
  test: boolean
}

export interface TaskRunOutcome {
  status: TaskRunRecord['status']
  summary: string
  error: string | null
}

export interface TaskSchedulerEvent {
  type: 'started' | 'finished' | 'missed' | 'queued' | 'cancelled'
  taskId: string
  runId?: string
  message?: string
}

export interface TaskSchedulerOptions {
  now: () => number
  execute: (request: TaskRunRequest) => Promise<TaskRunOutcome>
  onEvent: (event: TaskSchedulerEvent) => void
  maxConcurrent?: number
  maxRunsPerHour?: number
  catchupMs?: number
  cancelRun?: (taskId: string) => boolean
}

export class TaskScheduler {
  private readonly active = new Map<string, string>()
  private readonly startsByTask = new Map<string, number[]>()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: TaskSchedulerOptions) {}

  private get maxConcurrent(): number {
    return this.options.maxConcurrent ?? 3
  }

  private get maxRunsPerHour(): number {
    return this.options.maxRunsPerHour ?? 20
  }

  private get catchupMs(): number {
    return this.options.catchupMs ?? MAX_CATCHUP_MS
  }

  private rateLimited(taskId: string, now: number): boolean {
    const recent = (this.startsByTask.get(taskId) ?? []).filter((time) => now - time < 60 * 60 * 1000)
    this.startsByTask.set(taskId, recent)
    return recent.length >= this.maxRunsPerHour
  }

  canDispatch(taskId: string, now = this.options.now()): boolean {
    return !this.active.has(taskId) && this.active.size < this.maxConcurrent && !this.rateLimited(taskId, now)
  }

  /** Check due tasks. Safe to call from a fake clock in tests. */
  tick(): void {
    const now = this.options.now()
    for (const task of listTasks()) {
      if (!task.enabled || task.nextRunAt === null) continue
      if (task.nextRunAt > now) continue

      if (now - task.nextRunAt > this.catchupMs) {
        this.options.onEvent({
          type: 'missed',
          taskId: task.id,
          message: 'The scheduled run was more than 12 hours late and was skipped.'
        })
        const nextRunAt = computeNextRun(task.schedule, now)
        this.setNextRun(task.id, nextRunAt)
        continue
      }

      if (!this.canDispatch(task.id, now)) {
        this.options.onEvent({ type: 'queued', taskId: task.id, message: 'Run deferred by concurrency or rate limits.' })
        continue
      }

      void this.dispatch(task, now, false)
    }
  }

  async runNow(taskId: string, test = false): Promise<TaskRunOutcome> {
    const task = getTask(taskId)
    if (!task) throw new Error('Task not found.')
    const now = this.options.now()
    if (!this.canDispatch(taskId, now)) throw new Error('Task is already running or rate-limited.')
    if (test) return this.executeTest(task, now)
    return this.dispatch(task, now, false)
  }

  private async executeTest(task: TaskRecord, now: number): Promise<TaskRunOutcome> {
    const runId = startTaskRun(task.id, now)
    this.active.set(task.id, runId)
    this.rateLimited(task.id, now)
    const starts = this.startsByTask.get(task.id) ?? []
    starts.push(now)
    this.startsByTask.set(task.id, starts)
    this.options.onEvent({ type: 'started', taskId: task.id, runId })
    try {
      const outcome = await this.options.execute({ task, runId, test: true })
      finishTaskRun(runId, outcome.status, outcome.summary, outcome.error, this.options.now())
      this.options.onEvent({ type: 'finished', taskId: task.id, runId, message: outcome.summary })
      return outcome
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishTaskRun(runId, 'failed', 'Task run failed.', message, this.options.now())
      this.options.onEvent({ type: 'finished', taskId: task.id, runId, message })
      throw error
    } finally {
      this.active.delete(task.id)
    }
  }

  private async dispatch(task: TaskRecord, now: number, test: boolean): Promise<TaskRunOutcome> {
    const runId = startTaskRun(task.id, now)
    this.active.set(task.id, runId)
    const starts = this.startsByTask.get(task.id) ?? []
    starts.push(now)
    this.startsByTask.set(task.id, starts)
    recordRunStart(task.id, now)
    this.options.onEvent({ type: 'started', taskId: task.id, runId })
    try {
      const outcome = await this.options.execute({ task, runId, test })
      finishTaskRun(runId, outcome.status, outcome.summary, outcome.error, this.options.now())
      this.options.onEvent({ type: 'finished', taskId: task.id, runId, message: outcome.summary })
      return outcome
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishTaskRun(runId, 'failed', 'Task run failed.', message, this.options.now())
      this.options.onEvent({ type: 'finished', taskId: task.id, runId, message })
      return { status: 'failed', summary: 'Task run failed.', error: message }
    } finally {
      this.active.delete(task.id)
    }
  }

  private setNextRun(taskId: string, nextRunAt: number | null): void {
    getDb().update(tasks).set({ nextRunAt }).where(eq(tasks.id, taskId)).run()
  }

  cancel(taskId: string): boolean {
    if (!this.active.has(taskId)) return false
    const stopped = this.options.cancelRun?.(taskId) ?? false
    if (stopped) this.options.onEvent({ type: 'cancelled', taskId })
    return stopped
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 30_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
