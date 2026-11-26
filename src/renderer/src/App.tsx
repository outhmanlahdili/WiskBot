import { useCallback, useEffect, useState } from 'react'
import type {
  AppEvent,
  AuditEventRecord,
  Conversation,
  Language,
  PermissionDefaults,
  ProviderDefinitionPublic,
  ProviderPublic,
  Settings
} from '../../shared/ipc'
import { AuditView, PlaceholderView } from './components/SimpleViews'
import { ChatView } from './components/ChatView'
import { SettingsView } from './components/SettingsView'
import { Sidebar, type Page } from './components/Sidebar'
import { applyDocumentLanguage } from './lib/i18n'

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('chat')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [language, setLanguage] = useState<Language>('en')
  const [providers, setProviders] = useState<ProviderPublic[]>([])
  const [providerDefinitions, setProviderDefinitions] = useState<ProviderDefinitionPublic[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [audit, setAudit] = useState<AuditEventRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [nextSettings, nextProviders, nextDefinitions, nextConversations, nextAudit] =
        await Promise.all([
          window.wiskbot.send('settings.get'),
          window.wiskbot.send('providers.list'),
          window.wiskbot.send('providers.definitions'),
          window.wiskbot.send('conversations.list'),
          window.wiskbot.send('audit.list', {})
        ])
      setSettings(nextSettings)
      setLanguage(nextSettings.language)
      applyDocumentLanguage(nextSettings.language)
      setProviders(nextProviders)
      setProviderDefinitions(nextDefinitions)
      setAudit(nextAudit)

      let list = nextConversations
      if (list.length === 0) {
        const created = await window.wiskbot.send('conversations.create', {})
        list = [created]
      }
      setConversations(list)
      setActiveId((current) =>
        current && list.some((item) => item.id === current) ? current : (list[0]?.id ?? null)
      )
    } catch (cause) {
      setError(String(cause))
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.wiskbot.onEvent((event: AppEvent) => {
      switch (event.type) {
        case 'provider.event':
        case 'permission.changed':
          void refresh()
          break
        case 'chat.event':
          if (event.event.event === 'error') {
            setError(event.event.message)
          }
          break
        case 'app.error':
          setError(event.message)
          break
        case 'task.event':
          break
      }
    })
    void refresh()
    return unsubscribe
  }, [refresh])

  const changeLanguage = async (next: Language) => {
    try {
      const updated = await window.wiskbot.send('settings.update', { language: next })
      setSettings(updated)
      setLanguage(updated.language)
      applyDocumentLanguage(updated.language)
    } catch (cause) {
      setError(String(cause))
    }
  }

  const changePermissions = async (defaults: PermissionDefaults) => {
    try {
      const updated = await window.wiskbot.send('settings.update', { permissionDefaults: defaults })
      setSettings(updated)
    } catch (cause) {
      setError(String(cause))
    }
  }

  const newChat = async () => {
    try {
      const created = await window.wiskbot.send('conversations.create', {})
      setConversations((current) => [created, ...current])
      setActiveId(created.id)
      setPage('chat')
    } catch (cause) {
      setError(String(cause))
    }
  }

  const selectedProviderId = providers.find((provider) => provider.enabled)?.id ?? ''

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {error || 'Loading WiskBot…'}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar
        page={page}
        onPage={setPage}
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={() => void newChat()}
        language={language}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div
            role="alert"
            className="border-b border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            {error}
            <button type="button" className="float-end" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {page === 'chat' && (
          <ChatView
            language={language}
            conversationId={activeId ?? ''}
            providerId={selectedProviderId}
            onError={setError}
          />
        )}
        {page === 'settings' && (
          <SettingsView
            language={language}
            settings={settings}
            providers={providers}
            definitions={providerDefinitions}
            onLanguage={(next) => void changeLanguage(next)}
            onPermissions={(defaults) => void changePermissions(defaults)}
            onRefresh={() => void refresh()}
            onError={setError}
          />
        )}
        {page === 'audit' && <AuditView language={language} events={audit} />}
        {page === 'tasks' && <PlaceholderView language={language} kind="tasks" />}
        {page === 'skills' && <PlaceholderView language={language} kind="skills" />}
      </main>
    </div>
  )
}
