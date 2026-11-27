import { useCallback, useEffect, useState } from 'react'
import type {
  Language,
  TaskRecord,
  TaskRunRecord,
  TaskSchedule
} from '../../../shared/ipc'
import { translate, type TranslationKey } from '../lib/i18n'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input, Textarea } from './ui/input'

interface TasksViewProps {
  language: Language
  onError: (message: string) => void
}

type ScheduleKind = TaskSchedule['kind']

interface TestResult {
  status: string
  summary: string
  error: string | null
}

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '')
}

function shortText(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function TasksView({ language, onError }: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [runs, setRuns] = useState<TaskRunRecord[]>([])
  const [prompt, setPrompt] = useState('')
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval')
  const [at, setAt] = useState('')
  const [minutes, setMinutes] = useState('60')
  const [cronExpression, setCronExpression] = useState('')
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [formMessage, setFormMessage] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const t = (key: TranslationKey) => translate(language, key)

  const refresh = useCallback(async () => {
    try {
      const [nextTasks, nextRuns] = await Promise.all([
        window.wiskbot.send('tasks.list'),
        window.wiskbot.send('tasks.runs', { limit: 200 })
      ])
      setTasks(nextTasks)
      setRuns(nextRuns)
    } catch (cause) {
      onError(String(cause))
    }
  }, [onError])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return window.wiskbot.onEvent((event) => {
      if (event.type === 'task.event') void refresh()
    })
  }, [refresh])

  const kindLabel = (kind: TaskRecord['kind']): string =>
    kind === 'once'
      ? t('tasks.scheduleOnce')
      : kind === 'interval'
        ? t('tasks.scheduleInterval')
        : t('tasks.scheduleCron')

  const statusLabel = (status: string): string => {
    const key = `tasks.status.${status}` as TranslationKey
    const label = t(key)
    return label === key ? status : label
  }

  const formatDate = (value: number | null): string =>
    value === null ? t('tasks.summaryNone') : new Date(value).toLocaleString(language)

  const createTask = async () => {
    const value = prompt.trim()
    if (!value) {
      setFormMessage(t('tasks.promptRequired'))
      return
    }
    let schedule: TaskSchedule
    if (scheduleKind === 'once') {
      const timestamp = at ? new Date(at).getTime() : Number.NaN
      if (!Number.isFinite(timestamp)) {
        setFormMessage(t('tasks.invalidAt'))
        return
      }
      schedule = { kind: 'once', at: timestamp }
    } else if (scheduleKind === 'interval') {
      const parsed = Number(minutes)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60 * 24 * 30) {
        setFormMessage(t('tasks.invalidMinutes'))
        return
      }
      schedule = { kind: 'interval', minutes: parsed }
    } else {
      const expression = cronExpression.trim()
      const zone = timezone.trim()
      if (!expression || !zone) {
        setFormMessage(t('tasks.invalidCron'))
        return
      }
      schedule = { kind: 'cron', expression, timezone: zone }
    }
    setFormMessage('')
    try {
      await window.wiskbot.send('tasks.create', { prompt: value, schedule })
      setPrompt('')
      setFormMessage(t('tasks.created'))
      await refresh()
    } catch (cause) {
      onError(String(cause))
    }
  }

  const setEnabled = async (task: TaskRecord) => {
    try {
      await window.wiskbot.send('tasks.setEnabled', { id: task.id, enabled: !task.enabled })
      await refresh()
    } catch (cause) {
      onError(String(cause))
    }
  }

  const remove = async (taskId: string) => {
    try {
      await window.wiskbot.send('tasks.delete', { id: taskId })
      setTestResults((current) => {
        const next = { ...current }
        delete next[taskId]
        return next
      })
      await refresh()
    } catch (cause) {
      onError(String(cause))
    }
  }

  const test = async (taskId: string) => {
    setTestingId(taskId)
    try {
      const result = await window.wiskbot.send('tasks.test', { id: taskId })
      setTestResults((current) => ({ ...current, [taskId]: result }))
      await refresh()
    } catch (cause) {
      onError(String(cause))
    } finally {
      setTestingId(null)
    }
  }

  const cancel = async (taskId: string) => {
    try {
      await window.wiskbot.send('tasks.cancel', { id: taskId })
      await refresh()
    } catch (cause) {
      onError(String(cause))
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">{t('tasks.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('tasks.help')}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.createTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('tasks.prompt')}
              <Textarea
                value={prompt}
                maxLength={4000}
                placeholder={t('tasks.promptPlaceholder')}
                onChange={(event) => setPrompt(event.target.value)}
                aria-label={t('tasks.prompt')}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('tasks.schedule')}
              <select
                className="h-9 rounded-md border border-input bg-background px-2"
                value={scheduleKind}
                onChange={(event) => setScheduleKind(event.target.value as ScheduleKind)}
                aria-label={t('tasks.schedule')}
              >
                <option value="once">{t('tasks.scheduleOnce')}</option>
                <option value="interval">{t('tasks.scheduleInterval')}</option>
                <option value="cron">{t('tasks.scheduleCron')}</option>
              </select>
            </label>
            {scheduleKind === 'once' && (
              <label className="flex flex-col gap-1 text-sm">
                {t('tasks.at')}
                <Input
                  type="datetime-local"
                  value={at}
                  onChange={(event) => setAt(event.target.value)}
                  aria-label={t('tasks.at')}
                />
              </label>
            )}
            {scheduleKind === 'interval' && (
              <label className="flex flex-col gap-1 text-sm">
                {t('tasks.minutes')}
                <Input
                  type="number"
                  min={1}
                  max={60 * 24 * 30}
                  step={1}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  aria-label={t('tasks.minutes')}
                />
              </label>
            )}
            {scheduleKind === 'cron' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  {t('tasks.cronExpression')}
                  <Input
                    value={cronExpression}
                    maxLength={200}
                    placeholder="*/5 * * * *"
                    onChange={(event) => setCronExpression(event.target.value)}
                    aria-label={t('tasks.cronExpression')}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t('tasks.timezone')}
                  <Input
                    value={timezone}
                    maxLength={100}
                    onChange={(event) => setTimezone(event.target.value)}
                    aria-label={t('tasks.timezone')}
                  />
                </label>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void createTask()}>
                {t('tasks.create')}
              </Button>
              {formMessage && (
                <p className="text-sm text-muted-foreground">{formMessage}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.title')}</CardTitle>
            <CardDescription>{t('tasks.help')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {tasks.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('tasks.none')}</p>
            )}
            {tasks.map((task) => {
              const result = testResults[task.id]
              return (
                <div
                  key={task.id}
                  className="flex flex-wrap items-start gap-2 rounded-md border border-border p-3"
                >
                  <div className="min-w-40 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
                        {kindLabel(task.kind)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('tasks.nextRun')}: {task.enabled ? formatDate(task.nextRunAt) : t('tasks.paused')}
                      </span>
                    </div>
                    <div className="mt-1 text-sm" dir="auto">
                      {shortText(task.prompt)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t('tasks.lastRun')}: {formatDate(task.lastRunAt)}
                    </div>
                    {result && (
                      <div
                        className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
                        role="status"
                      >
                        <span>{format(t('tasks.result'), { status: statusLabel(result.status) })}</span>
                        {result.summary && (
                          <span className="min-w-0 break-words" dir="auto">
                            · {result.summary}
                          </span>
                        )}
                        {result.error && (
                          <span className="min-w-0 break-words text-destructive" dir="auto">
                            · {result.error}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void setEnabled(task)}
                    >
                      {task.enabled ? t('tasks.disable') : t('tasks.enable')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={testingId !== null}
                      onClick={() => void test(task.id)}
                    >
                      {testingId === task.id ? t('tasks.testing') : t('tasks.test')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void cancel(task.id)}
                    >
                      {t('tasks.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void remove(task.id)}
                    >
                      {t('tasks.delete')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.history')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {runs.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t('tasks.historyEmpty')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-start text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start">{t('tasks.historyTime')}</th>
                    <th className="px-4 py-2 text-start">{t('tasks.historyStatus')}</th>
                    <th className="px-4 py-2 text-start">{t('tasks.historyDetail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">{new Date(run.startedAt).toLocaleString(language)}</td>
                      <td className="px-4 py-2">{statusLabel(run.status)}</td>
                      <td className="px-4 py-2">
                        <span className="min-w-0 break-words" dir="auto">
                          {run.summary ?? run.error ?? t('tasks.summaryNone')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
