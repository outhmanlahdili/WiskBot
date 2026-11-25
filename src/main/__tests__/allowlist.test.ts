import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalizeWithinRoot, isAllowedDomain } from '../allowlist'

describe('path canonicalisation', () => {
  const root = join(process.cwd(), 'test-workspace')

  it('allows a path inside the root', () => {
    const result = canonicalizeWithinRoot(root, 'notes/file.txt')
    expect(result.ok).toBe(true)
  })

  it('rejects parent traversal', () => {
    const result = canonicalizeWithinRoot(root, '../secrets.txt')
    expect(result.ok).toBe(false)
  })

  it('rejects an absolute path outside the root', () => {
    const result = canonicalizeWithinRoot(root, join(process.cwd(), 'outside', 'file.txt'))
    expect(result.ok).toBe(false)
  })
})

describe('domain allowlist', () => {
  it('allows an exact HTTPS host', () => {
    expect(isAllowedDomain('https://example.com/path', ['example.com'])).toBe(true)
  })

  it('rejects look-alike and parent-suffix domains', () => {
    expect(isAllowedDomain('https://example.com.attacker.com', ['example.com'])).toBe(false)
    expect(isAllowedDomain('https://notexample.com', ['example.com'])).toBe(false)
    expect(isAllowedDomain('https://sub.example.com', ['example.com'])).toBe(false)
  })

  it('allows HTTP only for loopback hosts', () => {
    expect(isAllowedDomain('http://localhost:11434/v1', ['localhost'])).toBe(true)
    expect(isAllowedDomain('http://example.com/v1', ['example.com'])).toBe(false)
  })

  it('rejects non-HTTP protocols and malformed URLs', () => {
    expect(isAllowedDomain('file:///C:/secret', ['localhost'])).toBe(false)
    expect(isAllowedDomain('not a url', ['localhost'])).toBe(false)
  })
})
