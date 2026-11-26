import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import type {
  ApprovalDecision,
  ChatEvent,
  ChatMessageRecord,
  Language,
  RiskLevel
} from '../../../shared/ipc'
import { translate, type TranslationKey } from '../lib/i18n'
import { Button } from './ui/button'
import { Textarea } from './ui/input'

interface ChatViewProps {
  language: Language
  conversationId: string
  providerId: string
  onError: (message: string) => void
}

type ApprovalRequest = Extract<ChatEvent, { event: 'approval-request' }>
type BrowserStatus = Extract<ChatEvent, { event: 'browser-status' }>['status']
type DesktopStatus = Extract<ChatEvent, { event: 'desktop-status' }>['status']
type MemoryContextEntry = Extract<ChatEvent, { event: 'memory-context' }>['entries'][number]

function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '')
}

function shortText(value: unknown, max = 300): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  if (raw === undefined) return ''
  return raw.length > max ? `${raw.slice(0, max)}…` : raw
}

export function ChatView({ language, conversationId, providerId, onError }: ChatViewProps) {
  const [history, setHistory] = useState<ChatMessageRecord[]>([])
  const [parts, setParts] = useState<ChatEvent[]>([])
  const [localUserMessages, setLocalUserMessages] = useState<string[]>([])
  const [responded, setResponded] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus>('stopped')
  const [browserUrl, setBrowserUrl] = useState('')
  const [browserMessage, setBrowserMessage] = useState('')
  const [takeoverActive, setTakeoverActive] = useState(false)
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus>('stopped')
  const [desktopTitle, setDesktopTitle] = useState('')
  const [desktopMessage, setDesktopMessage] = useState('')
  const [desktopTakeoverActive, setDesktopTakeoverActive] = useState(false)
  const [memoryContext, setMemoryContext] = useState<MemoryContextEntry[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const t = (key: TranslationKey) => translate(language, key)

  useEffect(() => {
    let cancelled = false
    setParts([])
    setLocalUserMessages([])
    setResponded(new Set())
    setBusy(false)
    setNotice('')
    setMemoryContext(null)
    if (!conversationId) {
      setHistory([])
      return () => {
        cancelled = true
      }
    }
    void window.wiskbot
      .send('chat.messages', { conversationId })
      .then((records) => {
        if (!cancelled) setHistory(records)
      })
      .catch((cause) => {
        if (!cancelled) onError(String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, onError])

  useEffect(() => {
    let cancelled = false
    void window.wiskbot
      .send('browser.status')
      .then((state) => {
        if (cancelled) return
        setBrowserStatus(state.status)
        setBrowserUrl(state.url ?? '')
        setBrowserMessage(state.message ?? '')
      })
      .catch(() => {
        // The indicator stays at its default 'stopped' state if the query fails.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.wiskbot
      .send('desktop.status')
      .then((state) => {
        if (cancelled) return
        setDesktopStatus(state.status)
        setDesktopTitle(state.title ?? '')
        setDesktopMessage(state.message ?? '')
      })
      .catch(() => {
        // The indicator stays at its default 'stopped' state if the query fails.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.wiskbot.onEvent((event) => {
      if (event.type !== 'chat.event') return
      const incoming = event.event
      if (incoming.event === 'memory-context') {
        if (incoming.conversationId && incoming.conversationId !== conversationId) return
        setMemoryContext(incoming.entries)
        return
      }
      if (
        incoming.event === 'browser-status' ||
        incoming.event === 'browser-takeover' ||
        incoming.event === 'desktop-status' ||
        incoming.event === 'desktop-takeover'
      ) {
        if (incoming.conversationId && incoming.conversationId !== conversationId) return
        if (incoming.event === 'browser-status') {
          setBrowserStatus(incoming.status)
          setBrowserUrl(incoming.url ?? '')
          setBrowserMessage(incoming.message ?? '')
        } else if (incoming.event === 'browser-takeover') {
          setTakeoverActive(incoming.active)
        } else if (incoming.event === 'desktop-status') {
          setDesktopStatus(incoming.status)
          setDesktopTitle(incoming.title ?? '')
          setDesktopMessage(incoming.message ?? '')
        } else {
          setDesktopTakeoverActive(incoming.active)
        }
      } else if (incoming.conversationId !== conversationId) {
        return
      }
      setParts((current) => {
        if (
          incoming.event === 'approval-response' &&
          current.some(
            (part) =>
              part.event === 'approval-response' && part.approvalId === incoming.approvalId
          )
        ) {
          return current
        }
        return [...current, incoming]
      })
      if (incoming.event === 'done' || incoming.event === 'error') setBusy(false)
    })
  }, [conversationId])

  const assistantText = parts
    .filter((part): part is Extract<ChatEvent, { event: 'text-delta' }> => part.event === 'text-delta')
    .map((part) => part.delta)
    .join('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [parts.length, localUserMessages.length, assistantText.length])

  const send = async () => {
    const value = text.trim()
    if (!value || busy || takeoverActive || desktopTakeoverActive || !providerId) return
    setText('')
    setLocalUserMessages((current) => [...current, value])
    setBusy(true)
    try {
      const result = await window.wiskbot.send('chat.send', {
        conversationId,
        providerId,
        text: value
      })
      setNotice(result.reason ?? '')
      if (!result.accepted) setBusy(false)
    } catch (error) {
      setBusy(false)
      onError(String(error))
    }
  }

  const cancel = async () => {
    try {
      await window.wiskbot.send('chat.cancel', { conversationId })
      setBusy(false)
    } catch (error) {
      onError(String(error))
    }
  }

  const toggleTakeover = async () => {
    const active = !takeoverActive
    try {
      await window.wiskbot.send('browser.takeover', { active })
      setTakeoverActive(active)
    } catch (error) {
      onError(String(error))
    }
  }

  const stopBrowser = async () => {
    try {
      await window.wiskbot.send('browser.stop')
      setBrowserStatus('stopped')
      setBrowserUrl('')
    } catch (error) {
      onError(String(error))
    }
  }

  const toggleDesktopTakeover = async () => {
    const active = !desktopTakeoverActive
    try {
      await window.wiskbot.send('desktop.takeover', { active })
      setDesktopTakeoverActive(active)
    } catch (error) {
      onError(String(error))
    }
  }

  const stopDesktop = async () => {
    try {
      await window.wiskbot.send('desktop.stop')
      setDesktopStatus('stopped')
      setDesktopTitle('')
      setDesktopMessage('')
    } catch (error) {
      onError(String(error))
    }
  }

  const respond = async (
    request: ApprovalRequest,
    decision: ApprovalDecision,
    approved: boolean
  ) => {
    if (responded.has(request.approvalId)) return
    setResponded((current) => new Set(current).add(request.approvalId))
    setParts((current) =>
      current.some(
        (part) =>
          part.event === 'approval-response' && part.approvalId === request.approvalId
      )
        ? current
        : [
            ...current,
            {
              event: 'approval-response',
              conversationId: request.conversationId,
              approvalId: request.approvalId,
              approved,
              decision
            }
          ]
    )
    if (decision === 'deny') setBusy(false)
    try {
      await window.wiskbot.send('chat.respondApproval', {
        approvalId: request.approvalId,
        approved,
        decision
      })
    } catch (error) {
      onError(String(error))
    }
  }

  const riskBadge = (risk: RiskLevel) => (
    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
      {t(`risk.${risk}` as TranslationKey)}
    </span>
  )

  const memoryKindLabel = (kind: string): string => {
    const key = `memory.kind.${kind}` as TranslationKey
    const label = t(key)
    return label === key ? kind : label
  }

  const renderPart = (part: ChatEvent, index: number): React.JSX.Element | null => {
    switch (part.event) {
      case 'text-delta':
      case 'memory-context':
        return null
      case 'tool-call':
        return (
          <div key={index} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{t('chat.toolCall')}</span>
              <span className="font-medium">{part.toolName}</span>
              {riskBadge(part.risk)}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground" dir="auto">
              {part.target}
            </div>
          </div>
        )
      case 'tool-result':
        return (
          <div key={index} className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div className="text-xs font-medium text-muted-foreground">
              {t('chat.toolResult')} · {part.toolName}
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs" dir="auto">
              {shortText(part.output)}
            </pre>
          </div>
        )
      case 'tool-error':
        return (
          <div
            key={index}
            className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
          >
            <div className="font-medium">
              {t('chat.toolError')} · {part.toolName}
            </div>
            <div className="mt-1 text-xs" dir="auto">
              {part.message}
            </div>
          </div>
        )
      case 'approval-request': {
        const isResponded = responded.has(part.approvalId)
        return (
          <div key={index} className="rounded-lg border border-primary bg-primary/5 p-4">
            <h3 className="font-semibold">{t('approval.waiting')}</h3>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">{t('approval.tool')}: </span>
                <span>{part.toolName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('approval.risk')}:</span>
                {riskBadge(part.risk)}
              </div>
              <div className="min-w-0 break-words" dir="auto">
                <span className="text-muted-foreground">{t('approval.target')}: </span>
                <span>{part.target}</span>
              </div>
              <div className="min-w-0 break-words" dir="auto">
                <span className="text-muted-foreground">{t('approval.scope')}: </span>
                <span>{part.scope}</span>
              </div>
            </div>
            {part.preview && (
              <p className="mt-3 whitespace-pre-wrap text-sm" dir="auto">
                {part.preview}
              </p>
            )}
            <div className="mt-2">
              <div className="text-xs font-medium text-muted-foreground">{t('approval.input')}</div>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap" dir="auto">
                {shortText(part.input, 600)}
              </pre>
            </div>
            {part.expiresAt !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                {format(t('approval.expires'), {
                  time: new Date(part.expiresAt).toLocaleTimeString(language)
                })}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isResponded}
                onClick={() => void respond(part, 'allow-once', true)}
              >
                {t('approval.allowOnce')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isResponded}
                onClick={() => void respond(part, 'allow-session', true)}
              >
                {t('approval.allowSession')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isResponded}
                onClick={() => void respond(part, 'deny', false)}
              >
                {t('approval.deny')}
              </Button>
            </div>
          </div>
        )
      }
      case 'approval-response': {
        const label =
          part.decision === 'allow-once'
            ? t('chat.approvedOnce')
            : part.decision === 'allow-session'
              ? t('chat.approvedSession')
              : t('chat.denied')
        return (
          <div key={index} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
            {label}
          </div>
        )
      }
      case 'usage':
        return (
          <div key={index} className="text-xs text-muted-foreground">
            {format(t('chat.usage'), {
              prompt: String(part.promptTokens),
              completion: String(part.completionTokens),
              total: String(part.totalTokens)
            })}
          </div>
        )
      case 'done':
        return (
          <div key={index} className="text-xs text-muted-foreground">
            {part.finishReason ? format(t('chat.doneReason'), { reason: part.finishReason }) : t('chat.done')}
          </div>
        )
      case 'error':
        return (
          <div key={index} className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t('chat.error')}: <span dir="auto">{part.message}</span>
          </div>
        )
      case 'browser-status':
        return (
          <div key={index} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {format(t('browser.indicator'), {
              status: t(`browser.status.${part.status}` as TranslationKey)
            })}
            {part.url && <span dir="auto"> · {part.url}</span>}
            {part.message && <span dir="auto"> · {part.message}</span>}
          </div>
        )
      case 'browser-takeover':
        return (
          <div key={index} className="rounded-md border border-primary bg-primary/5 px-3 py-2 text-xs">
            {part.active ? t('browser.takeoverLine') : t('browser.resumeLine')}
            {part.message && <span dir="auto"> · {part.message}</span>}
          </div>
        )
      case 'desktop-status':
        return (
          <div key={index} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {format(t('desktop.indicator'), {
              status: t(`desktop.status.${part.status}` as TranslationKey)
            })}
            {part.title && <span dir="auto"> · {format(t('desktop.window'), { title: part.title })}</span>}
            {part.message && <span dir="auto"> · {part.message}</span>}
          </div>
        )
      case 'desktop-takeover':
        return (
          <div key={index} className="rounded-md border border-primary bg-primary/5 px-3 py-2 text-xs">
            {part.active ? t('desktop.takeoverLine') : t('desktop.resumeLine')}
            {part.message && <span dir="auto"> · {part.message}</span>}
          </div>
        )
    }
  }

  const empty =
    history.length === 0 &&
    localUserMessages.length === 0 &&
    parts.length === 0 &&
    assistantText.length === 0

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t('chat.title')}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={takeoverActive ? 'default' : 'outline'}
              onClick={() => void toggleTakeover()}
            >
              {takeoverActive ? t('browser.resume') : t('browser.takeover')}
            </Button>
            {(browserStatus !== 'stopped' || busy) && (
              <Button type="button" size="sm" variant="outline" onClick={() => void stopBrowser()}>
                {t('browser.stop')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={desktopTakeoverActive ? 'default' : 'outline'}
              onClick={() => void toggleDesktopTakeover()}
            >
              {desktopTakeoverActive ? t('desktop.resume') : t('desktop.takeover')}
            </Button>
            {desktopStatus !== 'stopped' && (
              <Button type="button" size="sm" variant="outline" onClick={() => void stopDesktop()}>
                {t('desktop.stop')}
              </Button>
            )}
          </div>
        </div>
        {!providerId && (
          <p className="mt-1 text-xs text-muted-foreground">{t('chat.noProvider')}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
          <span className="rounded border border-border bg-background px-1.5 py-0.5 font-medium">
            {format(t('browser.indicator'), {
              status: t(`browser.status.${browserStatus}` as TranslationKey)
            })}
          </span>
          {browserUrl && (
            <span
              className="min-w-0 max-w-full truncate text-muted-foreground"
              dir="auto"
              title={browserUrl}
            >
              {browserUrl}
            </span>
          )}
          {browserMessage && (
            <span className="min-w-0 break-words text-muted-foreground" dir="auto">
              {browserMessage}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('browser.untrusted')}</p>
        {desktopStatus === 'busy' && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="status"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden="true" />
            <span className="font-medium">{t('desktop.controlling')}</span>
            {desktopTitle && (
              <span className="min-w-0 break-words" dir="auto">
                {format(t('desktop.window'), { title: desktopTitle })}
              </span>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
          <span className="rounded border border-border bg-background px-1.5 py-0.5 font-medium">
            {format(t('desktop.indicator'), {
              status: t(`desktop.status.${desktopStatus}` as TranslationKey)
            })}
          </span>
          {desktopTitle && (
            <span
              className="min-w-0 max-w-full truncate text-muted-foreground"
              dir="auto"
              title={desktopTitle}
            >
              {format(t('desktop.window'), { title: desktopTitle })}
            </span>
          )}
          {desktopMessage && (
            <span className="min-w-0 break-words text-muted-foreground" dir="auto">
              {desktopMessage}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('desktop.untrusted')}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {empty && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <h2 className="text-xl font-medium">{t('chat.emptyTitle')}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{t('chat.emptyBody')}</p>
            <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t('chat.notice')}
            </p>
          </div>
        )}

        {history.map((message) => (
          <div key={message.id} className="rounded-md border border-border px-3 py-2 text-sm">
            <div className="text-xs font-medium text-muted-foreground">
              {t(`chat.role.${message.role}` as TranslationKey)}
            </div>
            <div className="mt-1 whitespace-pre-wrap" dir="auto">
              {message.content}
            </div>
          </div>
        ))}

        {localUserMessages.map((message, index) => (
          <div
            key={`local-${index}`}
            className="rounded-md bg-primary/10 px-3 py-2 text-sm"
          >
            <div className="text-xs font-medium text-muted-foreground">{t('chat.role.user')}</div>
            <div className="mt-1 whitespace-pre-wrap" dir="auto">
              {message}
            </div>
          </div>
        ))}

        {assistantText && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="text-xs font-medium text-muted-foreground">{t('chat.role.assistant')}</div>
            <div className={`mt-1 whitespace-pre-wrap ${busy ? 'animate-pulse' : ''}`} dir="auto">
              {assistantText}
            </div>
          </div>
        )}

        {memoryContext && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <div className="font-medium text-muted-foreground">{t('chat.contextTitle')}</div>
            <ul className="mt-1 flex flex-col gap-1">
              {memoryContext.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded border border-border bg-background px-1.5 py-0.5">
                    {memoryKindLabel(entry.kind)}
                  </span>
                  <span className="text-muted-foreground">{entry.id}</span>
                  <span className="min-w-0 break-words" dir="auto">
                    {shortText(entry.preview, 120)}
                  </span>
                  {!entry.trusted && (
                    <span className="rounded border border-destructive bg-destructive/10 px-1.5 py-0.5 text-destructive">
                      {t('chat.contextUntrusted')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {parts.map(renderPart)}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-4">
        {takeoverActive && (
          <div
            className="mx-auto mb-2 max-w-3xl rounded-md border border-primary bg-primary/5 px-3 py-2 text-xs text-primary"
            role="status"
          >
            {t('browser.takeoverHelp')}
          </div>
        )}
        {desktopTakeoverActive && (
          <div
            className="mx-auto mb-2 max-w-3xl rounded-md border border-primary bg-primary/5 px-3 py-2 text-xs text-primary"
            role="status"
          >
            {t('desktop.takeoverHelp')}
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={text}
            disabled={takeoverActive || desktopTakeoverActive}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
          />
          <Button
            type="button"
            disabled={busy || takeoverActive || desktopTakeoverActive || !providerId}
            onClick={() => void send()}
            aria-label={t('chat.send')}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
          {busy && (
            <Button type="button" variant="outline" onClick={() => void cancel()}>
              {t('chat.cancel')}
            </Button>
          )}
        </div>
        {notice && (
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-primary">{notice}</p>
        )}
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          {t('chat.streamingPlaceholder')}
        </p>
      </div>
    </div>
  )
}
