import { describe, expect, it } from 'vitest'
import { maskSecret, redactSecrets, safeErrorMessage } from '../redaction'

describe('redaction', () => {
  it('removes a known secret from text', () => {
    const secret = 'sk-abcdefgh12345678'
    const result = redactSecrets(`Authorization failed for ${secret}`, [secret])
    expect(result).not.toContain(secret)
    expect(result).toContain('[REDACTED]')
  })

  it('removes token-like values even without a registered secret', () => {
    expect(redactSecrets('key sk-abcdefgh12345678 leaked')).not.toContain('sk-abcdefgh')
    expect(redactSecrets('Authorization: Bearer abcdefgh12345678')).not.toContain(
      'abcdefgh12345678'
    )
  })

  it('redacts apiKey assignments', () => {
    const result = redactSecrets('config apiKey=supersecretvalue failed')
    expect(result).not.toContain('supersecretvalue')
  })

  it('never returns a raw key in an error message', () => {
    const secret = 'sk-abcdefgh12345678'
    const message = safeErrorMessage(new Error(`Provider rejected ${secret}`), [secret])
    expect(message).not.toContain(secret)
  })

  it('produces a hint that cannot reconstruct the key', () => {
    const secret = 'sk-abcdefgh12345678'
    const hint = maskSecret(secret)
    expect(hint).not.toContain(secret)
    expect(hint).toContain('••••')
  })
})
