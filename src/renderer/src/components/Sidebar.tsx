import {
  MessageSquare,
  Settings,
  ScrollText,
  Clock,
  Puzzle,
  FolderOpen
} from 'lucide-react'
import type { Conversation, Language } from '../../../shared/ipc'
import type { TranslationKey } from '../lib/i18n'
import { translate } from '../lib/i18n'
import { cn } from '../lib/utils'

export type Page = 'chat' | 'settings' | 'audit' | 'tasks' | 'skills'

interface SidebarProps {
  page: Page
  onPage: (page: Page) => void
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  language: Language
}

export function Sidebar({
  page,
  onPage,
  conversations,
  activeId,
  onSelect,
  onNewChat,
  language
}: SidebarProps) {
  const t = (key: TranslationKey) => translate(language, key)

  const navItems: Array<{ id: Page; label: TranslationKey; icon: typeof MessageSquare }> = [
    { id: 'chat', label: 'chat.title', icon: MessageSquare },
    { id: 'settings', label: 'nav.settings', icon: Settings },
    { id: 'audit', label: 'nav.audit', icon: ScrollText },
    { id: 'tasks', label: 'nav.tasks', icon: Clock },
    { id: 'skills', label: 'nav.skills', icon: Puzzle }
  ]

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-e border-border bg-secondary/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <FolderOpen className="h-5 w-5 text-primary flip-rtl" aria-hidden="true" />
        <div>
          <div className="font-semibold leading-tight">{t('app.name')}</div>
          <div className="text-xs text-muted-foreground">{t('app.tagline')}</div>
        </div>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + {t('nav.newChat')}
        </button>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPage(id)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left hover:bg-accent',
              page === id && 'bg-accent font-medium text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-2 px-1 text-xs font-medium uppercase text-muted-foreground">
          {t('nav.conversations')}
        </div>
        {conversations.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t('nav.noConversations')}</p>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                onSelect(conversation.id)
                onPage('chat')
              }}
              className={cn(
                'mb-1 w-full truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent',
                activeId === conversation.id && 'bg-accent'
              )}
            >
              {conversation.title}
            </button>
          ))
        )}
      </div>
    </aside>
  )
}
