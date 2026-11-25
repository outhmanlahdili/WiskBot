import { describe, expect, it } from 'vitest'
import {
  IpcRequestSchemas,
  ProviderUpsertSchema,
  SettingsUpdateSchema
} from '../../shared/ipc'

describe('settings.update validation', () => {
  it('accepts a partial update', () => {
    const parsed = SettingsUpdateSchema.parse({ language: 'ar' })
    expect(parsed).toEqual({ language: 'ar' })
  })

  it('rejects unknown keys', () => {
    const result = SettingsUpdateSchema.safeParse({ language: 'fr', telemetry: true })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported language', () => {
    expect(SettingsUpdateSchema.safeParse({ language: 'es' }).success).toBe(false)
  })

  it('is registered for the settings.update channel', () => {
    expect(IpcRequestSchemas['settings.update']).toBe(SettingsUpdateSchema)
  })
})

describe('providers.upsert validation', () => {
  const valid = {
    kind: 'openai' as const,
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'a-model',
    apiKey: 'sk-test-secret'
  }

  it('accepts a valid provider and applies the enabled default', () => {
    const parsed = ProviderUpsertSchema.parse(valid)
    expect(parsed.enabled).toBe(true)
    expect(parsed.apiKey).toBe('sk-test-secret')
  })

  it('accepts HTTP only for loopback endpoints', () => {
    expect(
      ProviderUpsertSchema.safeParse({ ...valid, baseUrl: 'http://localhost:11434/v1' }).success
    ).toBe(true)
    expect(
      ProviderUpsertSchema.safeParse({ ...valid, baseUrl: 'http://example.com/v1' }).success
    ).toBe(false)
  })

  it('rejects unknown keys and invalid ids', () => {
    expect(ProviderUpsertSchema.safeParse({ ...valid, surprise: 1 }).success).toBe(false)
    expect(ProviderUpsertSchema.safeParse({ ...valid, id: '../bad' }).success).toBe(false)
  })

  it('requires a model id', () => {
    expect(ProviderUpsertSchema.safeParse({ ...valid, modelId: '' }).success).toBe(false)
  })
})
