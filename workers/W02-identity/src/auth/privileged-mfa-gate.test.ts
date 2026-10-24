import { describe, expect, it } from 'vitest'
import { requireMfaForPrivilegedAction } from './privileged-mfa-gate.js'

class FakeStatement {
  constructor(private readonly row: Record<string, unknown> | null) {}
  bind() { return this }
  async first<T>() { return this.row as T | null }
}

class FakeD1 {
  constructor(private readonly row: Record<string, unknown> | null) {}
  prepare() { return new FakeStatement(this.row) }
}

const enabled = {
  enabled: 1,
  enabledAt: '2026-10-24T10:00:00.000Z',
  verified: 1,
}

describe('W02 privileged MFA gate', () => {
  it('denies if the account has not enabled MFA', async () => {
    expect(await requireMfaForPrivilegedAction(
      new FakeD1({ ...enabled, enabled: 0 }) as unknown as D1Database,
      'user-1',
      '2026-10-24T10:01:00.000Z',
    )).toBe(false)
  })

  it('denies an unverified authenticator enrollment', async () => {
    expect(await requireMfaForPrivilegedAction(
      new FakeD1({ ...enabled, verified: 0 }) as unknown as D1Database,
      'user-1',
      '2026-10-24T10:01:00.000Z',
    )).toBe(false)
  })

  it('denies sessions created before MFA activation', async () => {
    expect(await requireMfaForPrivilegedAction(
      new FakeD1(enabled) as unknown as D1Database,
      'user-1',
      '2026-10-24T09:59:59.999Z',
    )).toBe(false)
  })

  it('allows a verified MFA session created at or after activation', async () => {
    expect(await requireMfaForPrivilegedAction(
      new FakeD1(enabled) as unknown as D1Database,
      'user-1',
      new Date('2026-10-24T10:00:00.000Z'),
    )).toBe(true)
  })

  it('fails closed for missing or malformed session assurance timestamps', async () => {
    const db = new FakeD1(enabled) as unknown as D1Database
    expect(await requireMfaForPrivilegedAction(db, 'user-1', null)).toBe(false)
    expect(await requireMfaForPrivilegedAction(db, 'user-1', 'not-a-time')).toBe(false)
  })

  it('fails closed for absent authoritative user assurance', async () => {
    expect(await requireMfaForPrivilegedAction(
      new FakeD1(null) as unknown as D1Database,
      'user-1',
      '2026-10-24T10:01:00.000Z',
    )).toBe(false)
  })
})
