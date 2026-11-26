import { randomUUID } from 'node:crypto'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, type LanguageModel } from 'ai'
import { eq } from 'drizzle-orm'
import {
  ProviderCapabilitiesSchema,
  type ProviderKind,
  type ProviderPublic,
  type ProviderTestResult,
  type ProviderUpsert
} from '../../shared/ipc'
import { writeAuditEvent } from '../audit'
import { getDb } from '../database'
import { providers } from '../database/schema'
import { createFakeProvider } from '../fake-provider'
import { logger, registerSecret } from '../logger'
import { deleteKey, getKey, getKeyHint, hasKey, saveKey } from '../secure-store'
import { safeErrorMessage } from '../redaction'
import { getSettings } from '../settings'
import { getDefinition } from './definitions'

type ProviderRow = typeof providers.$inferSelect

function findRow(id: string): ProviderRow | undefined {
  return getDb().select().from(providers).where(eq(providers.id, id)).get()
}

async function toPublic(row: ProviderRow): Promise<ProviderPublic> {
  const definition = getDefinition(row.kind as ProviderKind)
  let capabilities = definition.capabilities
  try {
    capabilities = ProviderCapabilitiesSchema.parse(JSON.parse(row.capabilitiesJson))
  } catch {
    logger.warn('providers', 'Stored capabilities were invalid; using definition defaults.', {
      id: row.id
    })
  }

  const keyPresent = await hasKey(row.id)
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    enabled: row.enabled,
    capabilities,
    hasKey: keyPresent,
    keyHint: keyPresent ? await getKeyHint(row.id) : '',
    availabilityNote: definition.availabilityNote
  }
}

export async function listProviders(): Promise<ProviderPublic[]> {
  const rows = getDb().select().from(providers).all()
  return Promise.all(rows.map(toPublic))
}

export async function upsertProvider(input: ProviderUpsert): Promise<ProviderPublic> {
  const definition = getDefinition(input.kind)
  const id = input.id ?? `${input.kind}-${randomUUID().slice(0, 8)}`
  const values = {
    id,
    kind: input.kind,
    displayName: input.displayName,
    baseUrl: input.baseUrl,
    modelId: input.modelId,
    enabled: input.enabled ?? true,
    capabilitiesJson: JSON.stringify(definition.capabilities)
  }

  getDb()
    .insert(providers)
    .values(values)
    .onConflictDoUpdate({
      target: providers.id,
      set: {
        kind: values.kind,
        displayName: values.displayName,
        baseUrl: values.baseUrl,
        modelId: values.modelId,
        enabled: values.enabled,
        capabilitiesJson: values.capabilitiesJson
      }
    })
    .run()

  // An empty apiKey clears an existing key; omitting it keeps the stored key.
  if (input.apiKey !== undefined) {
    if (input.apiKey === '') await deleteKey(id)
    else await saveKey(id, input.apiKey)
  }

  writeAuditEvent('providers.upsert', id, 'allow', {
    kind: input.kind,
    modelId: input.modelId,
    keyProvided: input.apiKey !== undefined
  })
  logger.info('providers', 'Provider saved.', { id, kind: input.kind })
  return toPublic(findRow(id)!)
}

export async function removeProvider(id: string): Promise<boolean> {
  if (!findRow(id)) return false
  getDb().delete(providers).where(eq(providers.id, id)).run()
  await deleteKey(id)
  writeAuditEvent('providers.remove', id, 'allow', {})
  logger.info('providers', 'Provider removed.', { id })
  return true
}

function resolveModel(row: ProviderRow, apiKey: string) {
  switch (row.kind) {
    case 'meta-muse':
      return createOpenAI({ apiKey, baseURL: row.baseUrl }).responses(row.modelId)
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: row.baseUrl }).chat(row.modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: row.baseUrl }).chat(row.modelId)
    default:
      return createOpenAICompatible({
        name: row.kind,
        baseURL: row.baseUrl,
        apiKey
      }).chatModel(row.modelId)
  }
}

/** Resolve a model for the agent loop. Keys never leave the main process. */
export async function getModelForProvider(id: string): Promise<LanguageModel> {
  const row = findRow(id)
  if (!row) throw new Error('Provider not found.')
  if (!row.enabled) throw new Error('This provider is disabled.')

  if (row.kind === 'fake') {
    return createFakeProvider(
      () => getSettings().allowedFsRoots[0],
      () => {
        // Test fixtures are loopback-only and require WISKBOT_TEST_MODE=1.
        if (process.env['WISKBOT_TEST_MODE'] === '1') {
          return 'http://127.0.0.1:7788/fixture.html'
        }
        const domain = getSettings().browserDomains[0]
        return domain ? `https://${domain}/` : undefined
      },
      () => getSettings().desktopWindowTitles[0]
    ).languageModel('fake-scripted')
  }

  const definition = getDefinition(row.kind as ProviderKind)
  const storedKey = (await getKey(id)) ?? ''
  if (definition.needsKey && !storedKey) {
    throw new Error(`No API key is stored for ${row.displayName}.`)
  }
  registerSecret(storedKey)
  return resolveModel(row, storedKey || 'ollama')
}

/** The ONLY network call in Phase 1. The key stays in main and is redacted from errors. */
export async function testProvider(id: string): Promise<ProviderTestResult> {
  const row = findRow(id)
  if (!row) return { ok: false, message: 'Provider not found.' }
  if (!row.enabled) return { ok: false, message: 'This provider is disabled.' }
  if (row.kind === 'fake') {
    return { ok: true, message: 'Fake provider is available locally (no network).', latencyMs: 0 }
  }

  const definition = getDefinition(row.kind as ProviderKind)
  const storedKey = (await getKey(id)) ?? ''
  if (definition.needsKey && !storedKey) {
    return {
      ok: false,
      message: `No API key is stored for ${row.displayName}. Add one in Settings and try again.`
    }
  }
  if (!row.modelId.trim()) {
    return { ok: false, message: 'Enter a model id before testing the connection.' }
  }

  const apiKey = storedKey || 'ollama'
  registerSecret(storedKey)
  const started = Date.now()

  try {
    const model = resolveModel(row, apiKey)
    const museOptions = row.kind === 'meta-muse'
      ? {
          providerOptions: {
            openai: {
              store: false,
              include: ['reasoning.encrypted_content' as const]
            }
          }
        }
      : {}

    await generateText({
      model,
      prompt: 'Reply with exactly: OK',
      maxOutputTokens: 16,
      abortSignal: AbortSignal.timeout(10000),
      ...museOptions
    })

    const latencyMs = Date.now() - started
    writeAuditEvent('providers.test', id, 'allow', { ok: true, latencyMs, modelId: row.modelId })
    return { ok: true, message: 'Connection succeeded.', latencyMs }
  } catch (error) {
    const message = safeErrorMessage(error, [storedKey, apiKey])
    writeAuditEvent('providers.test', id, 'error', { ok: false, message })
    logger.warn('providers', 'Connection test failed.', { id, message })
    return { ok: false, message }
  }
}
