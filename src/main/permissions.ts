import type { PermissionDefaults, PermissionMode, RiskLevel } from '../shared/ipc'
import { isInside } from './allowlist'

export type PermissionDecision = 'allow' | 'deny' | 'ask-user' | 'allow-once' | 'allow-session'

export interface DecisionInput {
  risk: RiskLevel
  mode: PermissionMode
  /** Present when the user has already granted a scoped session allowance. */
  sessionGranted?: boolean
}

/**
 * Phase 1 decision helper. The full PermissionEngine (scopes, budgets,
 * allowlists, audit writes) arrives in Phase 2 — this is deliberately small
 * and total so it can be unit tested now.
 */
export function decidePermission(input: DecisionInput): {
  decision: PermissionDecision
  reason: string
} {
  if (input.risk === 'privileged') {
    return { decision: 'deny', reason: 'Privileged tools are blocked in this product.' }
  }

  if (input.mode === 'deny') {
    return { decision: 'deny', reason: 'Permission is explicitly denied.' }
  }

  if (input.sessionGranted) {
    return { decision: 'allow-session', reason: 'Allowed for this session.' }
  }

  switch (input.mode) {
    case 'allow-once':
      return { decision: 'allow-once', reason: 'Allowed once for this call.' }
    case 'allow-session':
      return { decision: 'allow-session', reason: 'Allowed for this session.' }
    case 'allow-always':
      if (input.risk === 'read') {
        return { decision: 'allow', reason: 'Low-risk tool inside a granted scope.' }
      }
      return { decision: 'ask-user', reason: 'Allow-always is only valid for low-risk tools.' }
    case 'ask':
    default:
      return { decision: 'ask-user', reason: 'User approval is required.' }
  }
}

export const DEFAULT_PERMISSION_DEFAULTS: PermissionDefaults = {
  read: 'allow-once',
  write: 'ask',
  external: 'ask',
  destructive: 'ask'
}

/** Risk ordering used when comparing a requested risk to a granted ceiling. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  read: 0,
  write: 1,
  external: 2,
  destructive: 3,
  privileged: 4
}

export function riskAtMost(requested: RiskLevel, ceiling: RiskLevel): boolean {
  return RISK_ORDER[requested] <= RISK_ORDER[ceiling]
}

export const SESSION_GRANT_TTL_MS = 30 * 60 * 1000

interface SessionGrant {
  toolName: string
  target: string
  expiresAt: number
}

/** In-memory, per-conversation grants. Never persisted, never sent to renderer. */
const sessionGrants = new Map<string, Map<string, SessionGrant>>()

function grantKey(toolName: string, target: string): string {
  return `${toolName}|${target}`
}

export function grantSession(
  conversationId: string,
  toolName: string,
  target: string,
  now = Date.now(),
  ttlMs = SESSION_GRANT_TTL_MS
): void {
  let map = sessionGrants.get(conversationId)
  if (!map) {
    map = new Map()
    sessionGrants.set(conversationId, map)
  }
  map.set(grantKey(toolName, target), {
    toolName,
    target,
    expiresAt: now + ttlMs
  })
}

export function hasSessionGrant(
  conversationId: string,
  toolName: string,
  target: string,
  now = Date.now()
): boolean {
  const grant = sessionGrants.get(conversationId)?.get(grantKey(toolName, target))
  if (!grant) return false
  if (grant.expiresAt <= now) {
    sessionGrants.get(conversationId)?.delete(grantKey(toolName, target))
    return false
  }
  return true
}

export function revokeSessionGrants(conversationId: string): void {
  sessionGrants.delete(conversationId)
}

/**
 * Plain reads inside WiskBot's own memory/skills folders never prompt.
 * The resolved absolute path must be inside one of `ownDirs`.
 */
export function isOwnReadPath(resolvedPath: string, ownDirs: string[]): boolean {
  return ownDirs.some((dir) => isInside(dir, resolvedPath))
}
