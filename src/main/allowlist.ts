import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export type CheckResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/**
 * Resolve `candidate` and verify it is inside `root`. Rejects traversal and
 * absolute escapes; also rejects an existing symlink whose real target is
 * outside the root.
 */
export function canonicalizeWithinRoot(root: string, candidate: string): CheckResult {
  const rootAbs = resolve(root)
  const resolved = resolve(rootAbs, candidate)

  if (!isInside(rootAbs, resolved)) {
    return { ok: false, reason: 'Path is outside the allowed root.' }
  }

  if (existsSync(resolved)) {
    let realRoot = rootAbs
    let realTarget = resolved
    try {
      realRoot = realpathSync(rootAbs)
      realTarget = realpathSync(resolved)
    } catch {
      return { ok: false, reason: 'Path could not be resolved safely.' }
    }
    if (!isInside(realRoot, realTarget)) {
      return { ok: false, reason: 'Path escapes the allowed root through a link.' }
    }
    return { ok: true, path: realTarget }
  }

  return { ok: true, path: resolved }
}

export function isInside(root: string, target: string): boolean {
  const rootNorm = normalizeForCompare(root)
  const targetNorm = normalizeForCompare(target)
  if (targetNorm === rootNorm) return true
  const rel = relative(rootNorm, targetNorm)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function normalizeForCompare(value: string): string {
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Exact-host allowlist. Subdomains and look-alike hosts such as
 * `example.com.attacker.com` are NOT automatically allowed.
 */
export function isAllowedDomain(url: string, allowedHosts: Iterable<string>): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  const host = canonicalHost(parsed.hostname)
  if (!host) return false
  if (parsed.protocol === 'http:' && !isLoopback(host)) return false

  for (const entry of allowedHosts) {
    if (canonicalHost(entry) === host) return true
  }
  return false
}

function canonicalHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

export type BrowserUrlResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string }

/**
 * Resolve and validate a browser navigation target. Production allows only
 * HTTPS to an explicitly listed host. Test mode (WISKBOT_TEST_MODE=1) also
 * permits loopback HTTP and local file:// fixtures.
 */
export function resolveBrowserUrl(
  raw: string,
  allowedHosts: Iterable<string>,
  testMode = process.env['WISKBOT_TEST_MODE'] === '1'
): BrowserUrlResult {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'Enter a valid URL.' }
  }

  if (parsed.protocol === 'file:') {
    if (!testMode) return { ok: false, reason: 'file:// URLs are not allowed.' }
    return { ok: true, url: parsed.href, host: 'file' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only HTTPS URLs are allowed.' }
  }

  const host = canonicalHost(parsed.hostname)
  if (!host) return { ok: false, reason: 'URL has no host.' }

  if (parsed.protocol === 'http:') {
    if (!testMode || !isLoopback(host)) {
      return { ok: false, reason: 'HTTP is only allowed for loopback test fixtures.' }
    }
    return { ok: true, url: parsed.href, host }
  }

  if (!testMode && isLoopback(host)) {
    return { ok: false, reason: 'Loopback hosts are not available in normal use.' }
  }

  for (const entry of allowedHosts) {
    if (canonicalHost(entry) === host) return { ok: true, url: parsed.href, host }
  }
  return { ok: false, reason: `Domain "${host}" is not in the browser allowlist.` }
}

/** Used by the window's external-link handler. */
export function allowExternalHttps(url: string, allowedHosts: Iterable<string>): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  const host = canonicalHost(parsed.hostname)
  for (const entry of allowedHosts) {
    if (canonicalHost(entry) === host) return parsed.toString()
  }
  return null
}

export { sep }
