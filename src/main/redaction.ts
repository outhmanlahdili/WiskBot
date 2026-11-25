/**
 * Redaction helpers. Keys and token-like values must never reach a log, an
 * error shown to the user, or an IPC result.
 */

const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|token|secret|password|MODEL_API_KEY)\b\s*[:=]\s*["']?[^\s"',;}]{4,}/gi
]

export function redactSecrets(text: string, secrets: Iterable<string> = []): string {
  let result = text
  const sorted = [...secrets]
    .filter((secret) => typeof secret === 'string' && secret.length >= 4)
    .sort((a, b) => b.length - a.length)

  for (const secret of sorted) {
    result = result.split(secret).join('[REDACTED]')
  }

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }

  return result
}

export function safeErrorMessage(error: unknown, secrets: Iterable<string> = []): string {
  const raw = error instanceof Error ? (error.message || error.name) : String(error)
  return truncate(redactSecrets(raw, secrets))
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** A hint only — never enough to reconstruct the secret. */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  const value = secret.trim()
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 3)}••••${value.slice(-3)}`
}
