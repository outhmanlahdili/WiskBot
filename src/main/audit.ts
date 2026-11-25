import { randomUUID } from 'node:crypto'
import { redactSecrets } from './redaction'
import { auditEvents, getDb } from './database'

/** Append-only audit writes. Never pass a raw key to `detail`. */
export function writeAuditEvent(
  action: string,
  target: string,
  decision: string,
  detail: Record<string, unknown> = {}
): void {
  let detailJson = '{}'
  try {
    detailJson = redactSecrets(JSON.stringify(detail))
  } catch {
    detailJson = JSON.stringify({ note: 'detail could not be serialised' })
  }
  getDb()
    .insert(auditEvents)
    .values({
      id: randomUUID(),
      ts: Date.now(),
      actor: 'system',
      action,
      target,
      decision,
      detailJson
    })
    .run()
}
