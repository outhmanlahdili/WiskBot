import type { ProviderCapabilities, ProviderKind } from '../../shared/ipc'

export interface ProviderDefinition {
  kind: ProviderKind
  displayName: string
  defaultBaseUrl: string
  /** Empty means the user must choose a model id; we do not hard-code a free-model list. */
  defaultModelId: string
  needsKey: boolean
  capabilities: ProviderCapabilities
  availabilityNote?: string
  modelIdPlaceholder?: string
}

export const PROVIDER_DEFINITIONS: Record<ProviderKind, ProviderDefinition> = {
  openai: {
    kind: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true },
    modelIdPlaceholder: 'e.g. gpt-4o-mini'
  },
  anthropic: {
    kind: 'anthropic',
    displayName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true },
    modelIdPlaceholder: 'e.g. claude-3-5-haiku-latest'
  },
  google: {
    kind: 'google',
    displayName: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true },
    modelIdPlaceholder: 'e.g. gemini-2.0-flash'
  },
  groq: {
    kind: 'groq',
    displayName: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true }
  },
  mistral: {
    kind: 'mistral',
    displayName: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true }
  },
  deepseek: {
    kind: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true }
  },
  openrouter: {
    kind: 'openrouter',
    displayName: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModelId: '',
    needsKey: true,
    capabilities: { streaming: true, tools: true },
    availabilityNote: 'Free tiers and model ids change; check the provider model list.'
  },
  'meta-muse': {
    kind: 'meta-muse',
    displayName: 'Meta Model API (Muse)',
    defaultBaseUrl: 'https://api.meta.ai/v1',
    defaultModelId: 'muse-spark-1.3',
    needsKey: true,
    capabilities: { streaming: true, tools: true, responses: true, reasoning: true },
    availabilityNote:
      'Availability depends on your region. Access is controlled by Meta per jurisdiction; no workaround is suggested.'
  },
  ollama: {
    kind: 'ollama',
    displayName: 'Ollama (local)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModelId: '',
    needsKey: false,
    capabilities: { streaming: true, tools: true },
    availabilityNote: 'Runs locally; no API key is needed. Model size and hardware limits apply.'
  },
  'openai-compatible': {
    kind: 'openai-compatible',
    displayName: 'OpenAI-compatible endpoint',
    defaultBaseUrl: '',
    defaultModelId: '',
    needsKey: false,
    capabilities: { streaming: true, tools: true },
    modelIdPlaceholder: 'Model id exposed by your endpoint'
  }
}

export function getDefinition(kind: ProviderKind): ProviderDefinition {
  return PROVIDER_DEFINITIONS[kind]
}

export const PROVIDER_KINDS = Object.keys(PROVIDER_DEFINITIONS) as ProviderKind[]
