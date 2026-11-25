import { redactSecrets, safeErrorMessage } from './redaction'

/** Secrets currently in use; registered by the secure store / provider registry. */
const registeredSecrets = new Set<string>()

export function registerSecret(secret: string | undefined): void {
  if (secret && secret.length >= 4) registeredSecrets.add(secret)
}

export function unregisterSecret(secret: string | undefined): void {
  if (secret) registeredSecrets.delete(secret)
}

function emit(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  detail?: unknown
): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message: redactSecrets(message, registeredSecrets),
    ...(detail === undefined ? {} : { detail: redactSecrets(JSON.stringify(detail), registeredSecrets) })
  }
  const output = JSON.stringify(line)
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.log(output)
}

export const logger = {
  info: (scope: string, message: string, detail?: unknown) => emit('info', scope, message, detail),
  warn: (scope: string, message: string, detail?: unknown) => emit('warn', scope, message, detail),
  error: (scope: string, error: unknown, detail?: unknown) =>
    emit('error', scope, safeErrorMessage(error, registeredSecrets), detail)
}
