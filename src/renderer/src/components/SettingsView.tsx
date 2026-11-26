import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import type {
  Language,
  PermissionDefaults,
  PermissionMode,
  ProviderDefinitionPublic,
  ProviderKind,
  ProviderPublic,
  ProviderUpsert,
  RiskLevel,
  Settings
} from '../../../shared/ipc'
import { translate, type TranslationKey } from '../lib/i18n'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from './ui/dialog'

const MODES: PermissionMode[] = ['deny', 'ask', 'allow-once', 'allow-session', 'allow-always']
const RISKS: RiskLevel[] = ['read', 'write', 'external', 'destructive']

interface FormState {
  id?: string
  kind: ProviderKind
  displayName: string
  baseUrl: string
  modelId: string
  apiKey: string
  enabled: boolean
}

function blankForm(definitions: ProviderDefinitionPublic[]): FormState {
  const first = definitions[0]
  return {
    kind: first?.kind ?? 'openai-compatible',
    displayName: first?.displayName ?? '',
    baseUrl: first?.defaultBaseUrl ?? '',
    modelId: first?.defaultModelId ?? '',
    apiKey: '',
    enabled: true
  }
}

function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')
}

interface SettingsViewProps {
  language: Language
  settings: Settings
  providers: ProviderPublic[]
  definitions: ProviderDefinitionPublic[]
  onLanguage: (language: Language) => void
  onPermissions: (defaults: PermissionDefaults) => void
  onRefresh: () => void
  onError: (message: string) => void
}

export function SettingsView({
  language,
  settings,
  providers,
  definitions,
  onLanguage,
  onPermissions,
  onRefresh,
  onError
}: SettingsViewProps) {
  const [form, setForm] = useState<FormState>(() => blankForm(definitions))
  const [testing, setTesting] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [folderInput, setFolderInput] = useState('')
  const [folderMessage, setFolderMessage] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const t = (key: TranslationKey) => translate(language, key)

  const selectedDefinition = definitions.find((item) => item.kind === form.kind)

  const chooseKind = (kind: ProviderKind) => {
    const definition = definitions.find((item) => item.kind === kind) ?? definitions[0]
    setForm({
      ...form,
      kind,
      displayName: definition?.displayName ?? kind,
      baseUrl: definition?.defaultBaseUrl ?? '',
      modelId: definition?.defaultModelId ?? '',
      apiKey: ''
    })
  }

  const startEdit = (provider: ProviderPublic) => {
    setForm({
      id: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      modelId: provider.modelId,
      apiKey: '',
      enabled: provider.enabled
    })
    setTestMessage('')
  }

  const save = async () => {
    if (!form.displayName.trim() || !form.baseUrl.trim() || !form.modelId.trim()) {
      onError(t('settings.testFailure'))
      return
    }
    const payload: ProviderUpsert = {
      ...(form.id ? { id: form.id } : {}),
      kind: form.kind,
      displayName: form.displayName,
      baseUrl: form.baseUrl,
      modelId: form.modelId,
      enabled: form.enabled,
      ...(form.apiKey ? { apiKey: form.apiKey } : {})
    }
    try {
      await window.wiskbot.send('providers.upsert', payload)
      setForm(blankForm(definitions))
      setTestMessage('')
      onRefresh()
    } catch (error) {
      onError(String(error))
    }
  }

  const test = async (id: string) => {
    setTesting(id)
    setTestMessage(t('settings.testing'))
    try {
      const result = await window.wiskbot.send('providers.test', { id })
      setTestMessage(`${result.ok ? t('settings.testOk') : t('settings.testFailure')}: ${result.message}`)
    } catch (error) {
      setTestMessage(`${t('settings.testFailure')}: ${String(error)}`)
    } finally {
      setTesting(null)
    }
  }

  const remove = async (id: string) => {
    try {
      await window.wiskbot.send('providers.remove', { id })
      if (form.id === id) setForm(blankForm(definitions))
      onRefresh()
    } catch (error) {
      onError(String(error))
    }
  }

  const changePermission = (risk: RiskLevel, mode: PermissionMode) => {
    onPermissions({ ...settings.permissionDefaults, [risk]: mode })
  }

  const saveFolders = async (roots: string[]) => {
    try {
      await window.wiskbot.send('settings.update', { allowedFsRoots: roots })
      setFolderMessage('')
      onRefresh()
    } catch (error) {
      setFolderMessage(`${t('settings.testFailure')}: ${String(error)}`)
    }
  }

  const addFolder = async () => {
    const value = folderInput.trim()
    if (!isAbsolutePath(value)) {
      setFolderMessage(t('settings.invalidAbsolutePath'))
      return
    }
    if (settings.allowedFsRoots.includes(value)) {
      setFolderInput('')
      return
    }
    setFolderInput('')
    await saveFolders([...settings.allowedFsRoots, value])
  }

  const removeFolder = async (root: string) => {
    await saveFolders(settings.allowedFsRoots.filter((item) => item !== root))
  }

  const resetKeyStore = async () => {
    try {
      const result = await window.wiskbot.send('app.resetKeyStore', { confirmed: true })
      setResetMessage(result.reset ? t('settings.resetKeyStoreSuccess') : t('settings.resetKeyStoreError'))
      onRefresh()
    } catch (error) {
      setResetMessage(`${t('settings.resetKeyStoreError')}: ${String(error)}`)
    }
  }

  const deleteAll = async () => {
    try {
      await window.wiskbot.send('app.deleteLocalData')
      window.location.reload()
    } catch (error) {
      onError(String(error))
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="text-xl font-semibold">{t('settings.title')}</h1>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.providers')}</CardTitle>
            <CardDescription>{t('settings.providersHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {providers.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.none')}</p>
            )}
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
              >
                <div className="min-w-40 flex-1">
                  <div className="font-medium">{provider.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {provider.modelId} · {provider.hasKey ? `${t('settings.keyStored')} (${provider.keyHint})` : t('settings.noKey')}
                  </div>
                  {provider.availabilityNote && (
                    <div className="text-xs text-muted-foreground">{provider.availabilityNote}</div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => startEdit(provider)}>
                  {t('settings.editProvider')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testing !== null}
                  onClick={() => test(provider.id)}
                >
                  {testing === provider.id ? t('settings.testing') : t('settings.test')}
                </Button>
                <Button variant="destructive" size="icon" onClick={() => remove(provider.id)}>
                  <Trash2 className="h-4 w-4" aria-label={t('settings.delete')} />
                </Button>
              </div>
            ))}
            {testMessage && <p className="text-sm text-muted-foreground">{testMessage}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {form.id ? t('settings.editProvider') : t('settings.addProvider')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              {t('settings.kind')}
              <select
                className="h-9 rounded-md border border-input bg-background px-2"
                value={form.kind}
                onChange={(event) => chooseKind(event.target.value as ProviderKind)}
              >
                {definitions.map((definition) => (
                  <option key={definition.kind} value={definition.kind}>
                    {definition.displayName}
                  </option>
                ))}
              </select>
              {selectedDefinition?.availabilityNote && (
                <span className="text-xs text-muted-foreground">
                  {selectedDefinition.availabilityNote}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('settings.displayName')}
              <Input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('settings.baseUrl')}
              <Input
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('settings.modelId')}
              <Input
                value={form.modelId}
                placeholder={selectedDefinition?.modelIdPlaceholder}
                onChange={(event) => setForm({ ...form, modelId: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              {t('settings.apiKey')}
              <Input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">{t('settings.apiKeyHelp')}</span>
              <span className="text-xs text-muted-foreground">
                {selectedDefinition?.needsKey === false
                  ? t('settings.keyOptional')
                  : t('settings.keyRequired')}
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              {t('settings.enabled')}
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="button" onClick={() => void save()}>
                {t('settings.save')}
              </Button>
              {form.id && (
                <Button type="button" variant="outline" onClick={() => setForm(blankForm(definitions))}>
                  {t('settings.cancel')}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t('settings.keyNeverRendered')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.allowedFolders')}</CardTitle>
            <CardDescription>{t('settings.allowedFoldersHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {settings.allowedFsRoots.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.allowedFoldersNone')}</p>
            )}
            {settings.allowedFsRoots.map((root) => (
              <div
                key={root}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-all" dir="auto">{root}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void removeFolder(root)}
                >
                  {t('settings.removeFolder')}
                </Button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t('settings.folderPath')}
                <Input
                  value={folderInput}
                  onChange={(event) => setFolderInput(event.target.value)}
                  aria-label={t('settings.folderPath')}
                />
              </label>
              <Button type="button" onClick={() => void addFolder()}>
                {t('settings.addFolder')}
              </Button>
            </div>
            {folderMessage && <p className="text-sm text-muted-foreground">{folderMessage}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.permissions')}</CardTitle>
            <CardDescription>{t('settings.permissionsHelp')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {RISKS.map((risk) => (
              <label key={risk} className="flex items-center justify-between gap-2 text-sm">
                <span className="capitalize">{t(`risk.${risk}` as TranslationKey)}</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2"
                  value={settings.permissionDefaults[risk]}
                  onChange={(event) => changePermission(risk, event.target.value as PermissionMode)}
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.language')}</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              className="h-9 rounded-md border border-input bg-background px-2"
              value={language}
              onChange={(event) => onLanguage(event.target.value as Language)}
              aria-label={t('settings.language')}
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
            </select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.resetKeyStore')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('settings.resetKeyStoreDescription')}</p>
            <p className="text-sm text-destructive">{t('settings.resetKeyStoreWarning')}</p>
            <div>
              <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">{t('settings.resetKeyStore')}</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t('settings.resetKeyStoreTitle')}</DialogTitle>
                    <DialogDescription>{t('settings.resetKeyStoreWarning')}</DialogDescription>
                  </DialogHeader>
                  <div className="mt-5 flex justify-end gap-2">
                    <DialogClose asChild>
                      <Button variant="outline">{t('settings.cancel')}</Button>
                    </DialogClose>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setResetOpen(false)
                        void resetKeyStore()
                      }}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      {t('settings.resetKeyStoreConfirm')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            {resetMessage && <p className="text-sm text-muted-foreground">{resetMessage}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.deleteAllData')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('settings.deleteAllData')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('settings.deleteAllTitle')}</DialogTitle>
                  <DialogDescription>{t('settings.deleteAllDescription')}</DialogDescription>
                </DialogHeader>
                <div className="mt-5 flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="outline">{t('settings.cancel')}</Button>
                  </DialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setDeleteOpen(false)
                      void deleteAll()
                    }}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    {t('settings.confirmDelete')}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
