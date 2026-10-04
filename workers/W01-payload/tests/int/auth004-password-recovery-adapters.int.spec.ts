import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('AUTH-004 Better Auth recovery boundary', () => {
  it('keeps password change on the Better Auth authority', () => {
    const source = read('src/app/auth/password/change/route.ts')
    expect(source).toContain("proxyBetterAuth")
    expect(source).toContain("'/change-password'")
    expect(source).not.toContain('payload.login(')
    expect(source).not.toContain('payload.update(')
  })

  it('keeps reset request enumeration-resistant and delegated to Better Auth', () => {
    const source = read('src/app/auth/password/reset/request/route.ts')
    expect(source).toContain("'/request-password-reset'")
    expect(source).toContain('identifier.trim().toLowerCase()')
    expect(source).not.toContain('forgotPassword(')
  })

  it('delegates reset confirmation to Better Auth without echoing the token', () => {
    const source = read('src/app/auth/password/reset/confirm/route.ts')
    expect(source).toContain("'/reset-password'")
    expect(source).toContain('recoveryToken')
    expect(source).not.toContain('resetPassword(')
  })
})
