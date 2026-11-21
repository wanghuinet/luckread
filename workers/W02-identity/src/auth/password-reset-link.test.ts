import { describe, expect, it } from 'vitest'
import { buildPasswordResetPageUrl } from './password-reset-link.js'

describe('password reset email link', () => {
  it('routes the Better Auth token to the public LuckRead reset page', () => {
    const token = 'A1b2C3d4E5f6G7h8I9j0K1l2'
    const generatedUrl =
      'https://luckread.com/api/auth/reset-password/' + token +
      '?callbackURL=https%3A%2F%2Fluckread.com%2Freset-password'

    const result = new URL(buildPasswordResetPageUrl(generatedUrl))

    expect(result.origin).toBe('https://luckread.com')
    expect(result.pathname).toBe('/reset-password')
    expect(result.searchParams.get('token')).toBe(token)
    expect(result.searchParams.has('callbackURL')).toBe(false)
  })

  it('rejects non-canonical origins and API paths', () => {
    expect(() => buildPasswordResetPageUrl(
      'https://evil.example/api/auth/reset-password/A1b2C3d4E5f6G7h8I9j0K1l2',
    )).toThrow('INVALID_PASSWORD_RESET_URL')
    expect(() => buildPasswordResetPageUrl(
      'https://luckread.com/api/auth/reset-password',
    )).toThrow('INVALID_PASSWORD_RESET_URL')
  })

  it('rejects malformed or non-URL-safe reset tokens', () => {
    expect(() => buildPasswordResetPageUrl(
      'https://luckread.com/api/auth/reset-password/%2Fetc%2Fpasswd',
    )).toThrow('INVALID_PASSWORD_RESET_URL')
    expect(() => buildPasswordResetPageUrl('not-a-url')).toThrow('INVALID_PASSWORD_RESET_URL')
  })
})
