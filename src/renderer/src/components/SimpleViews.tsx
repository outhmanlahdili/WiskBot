import type { AuditEventRecord, Language } from '../../../shared/ipc'
import { translate, type TranslationKey } from '../lib/i18n'
import { Card, CardContent } from './ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

interface AuditViewProps {
  language: Language
  events: AuditEventRecord[]
}

export function AuditView({ language, events }: AuditViewProps) {
  const t = (key: TranslationKey) => translate(language, key)
  const providers = events.filter((event) => event.action.startsWith('providers.'))

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-xl font-semibold">{t('audit.title')}</h1>
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <AuditTable language={language} events={events} emptyLabel={t('audit.empty')} />
          </TabsContent>
          <TabsContent value="providers">
            <AuditTable language={language} events={providers} emptyLabel={t('audit.empty')} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function AuditTable({
  language,
  events,
  emptyLabel
}: {
  language: Language
  events: AuditEventRecord[]
  emptyLabel: string
}) {
  const t = (key: TranslationKey) => translate(language, key)
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-start text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start">{t('audit.ts')}</th>
              <th className="px-4 py-2 text-start">{t('audit.action')}</th>
              <th className="px-4 py-2 text-start">{t('audit.target')}</th>
              <th className="px-4 py-2 text-start">{t('audit.decision')}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">{new Date(event.ts).toLocaleString()}</td>
                <td className="px-4 py-2">{event.action}</td>
                <td className="px-4 py-2">{event.target}</td>
                <td className="px-4 py-2">{event.decision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function PlaceholderView({
  language,
  kind
}: {
  language: Language
  kind: 'tasks' | 'skills'
}) {
  const t = (key: TranslationKey) => translate(language, key)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-xl font-semibold">
        {kind === 'tasks' ? t('nav.tasks') : t('nav.skills')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('placeholder.comingSoon')}</p>
      <p className="text-sm text-muted-foreground">
        {kind === 'tasks' ? t('placeholder.tasks') : t('placeholder.skills')}
      </p>
    </div>
  )
}
