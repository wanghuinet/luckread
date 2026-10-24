import { describe, expect, it } from 'vitest'
import { isPrivilegedMfaEnrollmentEligible, requireMfaForPrivilegedAction } from './privileged-mfa-gate.js'

class FakeStatement {
  private values: unknown[] = []
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async first<T>() {
    if (this.sql.includes('FROM "user"')) return this.db.row as T | null
    if (this.sql.includes('FROM role_assignments')) {
      const subjectId = this.values[0]
      const queriedRoles = this.values.slice(1, -2).map(String)
      return subjectId === this.db.subjectId && queriedRoles.some((role) => this.db.roles.includes(role))
        ? { id: 'ra-1' } as T
        : null
    }
    return null
  }
}

class FakeD1 {
  constructor(
    readonly row: Record<string, unknown> | null,
    readonly roles: string[] = [],
    readonly subjectId = 'user-1',
  ) {}
  prepare(sql: string) { return new FakeStatement(this, sql) }
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

describe('W02 privileged MFA enrollment eligibility', () => {
  it('allows enrollment for an effective global L7/L8 role even if the MFA gate downgraded its returned layer', async () => {
    expect(await isPrivilegedMfaEnrollmentEligible(
      new FakeD1(null, ['admin']) as unknown as D1Database,
      'user-1',
      '2026-10-24T10:00:00.000Z',
    )).toBe(true)
    expect(await isPrivilegedMfaEnrollmentEligible(
      new FakeD1(null, ['super_admin']) as unknown as D1Database,
      'user-1',
      '2026-10-24T10:00:00.000Z',
    )).toBe(true)
  })

  it('does not allow ordinary L1-L4 roles to enable privileged login MFA', async () => {
    for (const role of ['user', 'verified_user', 'creator', 'mcn_admin']) {
      expect(await isPrivilegedMfaEnrollmentEligible(
        new FakeD1(null, [role]) as unknown as D1Database,
        'user-1',
        '2026-10-24T10:00:00.000Z',
      )).toBe(false)
    }
  })

  it('fails closed for a different subject, invalid target, or invalid time', async () => {
    const db = new FakeD1(null, ['super_admin']) as unknown as D1Database
    expect(await isPrivilegedMfaEnrollmentEligible(db, 'another-user', '2026-10-24T10:00:00.000Z')).toBe(false)
    expect(await isPrivilegedMfaEnrollmentEligible(db, '', '2026-10-24T10:00:00.000Z')).toBe(false)
    expect(await isPrivilegedMfaEnrollmentEligible(db, 'user-1', 'bad-time')).toBe(false)
  })
})
