import { describe, expect, it } from 'vitest'
import { isMfaEnrollmentEligible, requireMfaForPrivilegedAction } from './privileged-mfa-gate.js'

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

describe('W02 MFA enrollment eligibility', () => {
  it('allows an active non-privileged first-L8 target to enroll before a RoleAssignment exists', () => {
    expect(isMfaEnrollmentEligible('target-user-1', 'ACTIVE')).toBe(true)
  })

  it('allows an ordinary active account to self-enroll without granting privileges', () => {
    // The helper intentionally accepts only server-derived account state,
    // never a client-supplied role or layer claim.
    expect(isMfaEnrollmentEligible('active-user-1', 'ACTIVE')).toBe(true)
  })

  it('denies non-active accounts', () => {
    expect(isMfaEnrollmentEligible('user-1', 'PENDING_VERIFICATION')).toBe(false)
    expect(isMfaEnrollmentEligible('user-1', 'SUSPENDED')).toBe(false)
  })

  it('fails closed for missing or invalid subject identifiers', () => {
    expect(isMfaEnrollmentEligible('', 'ACTIVE')).toBe(false)
    expect(isMfaEnrollmentEligible('x'.repeat(129), 'ACTIVE')).toBe(false)
    expect(isMfaEnrollmentEligible('user-1', '')).toBe(false)
  })
})
