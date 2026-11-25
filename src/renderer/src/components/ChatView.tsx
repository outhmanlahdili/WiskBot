import { useState } from 'react'
import { Send } from 'lucide-react'
import type { Language } from '../../../shared/ipc'
import { translate } from '../lib/i18n'
import { Button } from './ui/button'
import { Textarea } from './ui/input'

interface ChatViewProps {
  language: Language
  conversationId: string
  onError: (message: string) => void
}

export function ChatView({ language, conversationId, onError }: ChatViewProps) {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key)

  const send = async () => {
    const value = text.trim()
    if (!value) return
    setText('')
    try {
      const result = await window.wiskbot.send('chat.send', { conversationId, text: value })
      setNotice(result.reason ?? '')
    } catch (error) {
      onError(String(error))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{t('chat.title')}</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h2 className="text-xl font-medium">{t('chat.emptyTitle')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t('chat.emptyBody')}</p>
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('chat.notice')}
        </p>
        {notice && <p className="mt-2 text-xs text-primary">{notice}</p>}
      </div>

      <div className="border-t border-border p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
          />
          <Button type="button" onClick={send} aria-label={t('chat.send')}>
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          {t('chat.streamingPlaceholder')}
        </p>
      </div>
    </div>
  )
}
