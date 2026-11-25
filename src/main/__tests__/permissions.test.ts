import { describe, expect, it } from 'vitest'
import { decidePermission, DEFAULT_PERMISSION_DEFAULTS, riskAtMost } from '../permissions'

describe('permission decisions', () => {
  it('always denies privileged tools', () => {
    expect(decidePermission({ risk: 'privileged', mode: 'allow-once' }).decision).toBe('deny')
  })

  it('let an explicit deny win over a session grant', () => {
    expect(decidePermission({ risk: 'read', mode: 'deny', sessionGranted: true }).decision).toBe(
      'deny'
    )
  })

  it('shows an approval prompt for ask mode', () => {
    expect(decidePermission({ risk: 'destructive', mode: 'ask' }).decision).toBe('ask-user')
  })

  it('allows allow-always only for low-risk tools', () => {
    expect(decidePermission({ risk: 'read', mode: 'allow-always' }).decision).toBe('allow')
    expect(decidePermission({ risk: 'write', mode: 'allow-always' }).decision).toBe('ask-user')
  })

  it('honours session grants and single grants', () => {
    expect(decidePermission({ risk: 'external', mode: 'ask', sessionGranted: true }).decision).toBe(
      'allow-session'
    )
    expect(decidePermission({ risk: 'read', mode: 'allow-once' }).decision).toBe('allow-once')
  })

  it('uses safe defaults', () => {
    expect(DEFAULT_PERMISSION_DEFAULTS.write).toBe('ask')
    expect(DEFAULT_PERMISSION_DEFAULTS.destructive).toBe('ask')
  })

  it('compares risk levels', () => {
    expect(riskAtMost('read', 'write')).toBe(true)
    expect(riskAtMost('destructive', 'write')).toBe(false)
  })
})
