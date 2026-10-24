import { describe, expect, it } from 'vitest'
import { ensureBaseUserRole, ensureVerifiedUserRole, resolveGlobalLayer, type RoleAssignmentRecord } from './role-assignment.js'

const NOW = '2026-09-22T12:00:00.000Z'

function assignment(overrides: Partial<RoleAssignmentRecord> = {}): RoleAssignmentRecord {
  return {
    id: 'ra-1',
    subjectId: 'user-1',
    roleId: 'user',
    scopeType: 'global',
    scopeId: null,
    status: 'ACTIVE',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeD1(rows: RoleAssignmentRecord[], mfaEnabled = true) {
  let queryCount = 0
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async <T>() => {
          queryCount += 1
          const [subjectId, status, validFrom, evaluatedAt] = args as [string, string, string, string]
          return {
            results: rows.filter((row) =>
              row.subjectId === subjectId &&
              row.status === status &&
              row.validFrom <= validFrom &&
              (row.validUntil === null || evaluatedAt < row.validUntil),
            ).sort((a, b) => a.roleId.localeCompare(b.roleId) || a.id.localeCompare(b.id)) as T[],
          }
        },
        first: async <T>() => sql.includes('two_factor_enabled')
          ? ({ twoFactorEnabled: mfaEnabled ? 1 : 0 } as T)
          : null,
      }),
    }),
  }
  return { db: db as unknown as D1Database, getQueryCount: () => queryCount }
}

describe('RoleAssignment global layer resolution', () => {
  it('resolves a valid global user role', async () => {
    const { db } = fakeD1([assignment()])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L1' })
  })

  it('selects the highest numeric layer across multiple eligible global assignments', async () => {
    const { db } = fakeD1([
      assignment({ id: 'ra-user', roleId: 'user' }),
      assignment({ id: 'ra-creator', roleId: 'creator' }),
      assignment({ id: 'ra-admin', roleId: 'admin' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L7' })
  })

  it('treats equal-layer global assignments as equivalent', async () => {
    const { db } = fakeD1([
      assignment({ id: 'ra-ip', roleId: 'ip_principal' }),
      assignment({ id: 'ra-mcn-admin', roleId: 'mcn_admin' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L4' })
  })

  it('excludes organization and IP scoped assignments from global layer resolution', async () => {
    const { db } = fakeD1([
      assignment({ roleId: 'creator', scopeType: 'organization', scopeId: 'org-1' }),
      assignment({ roleId: 'admin', scopeType: 'ip', scopeId: 'ip-1' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('excludes revoked assignments', async () => {
    const { db } = fakeD1([
      assignment({ status: 'REVOKED' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('excludes future assignments', async () => {
    const { db } = fakeD1([
      assignment({ validFrom: '2026-09-23T00:00:00.000Z' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('excludes expired assignments at the exclusive validUntil boundary', async () => {
    const { db } = fakeD1([
      assignment({ validUntil: NOW }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('fails closed for an unknown global role', async () => {
    const { db } = fakeD1([
      assignment({ roleId: 'unknown_role' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('fails closed for a forbidden global role', async () => {
    const { db } = fakeD1([
      assignment({ roleId: 'founder' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('resolves the canonical L1 user role for an unverified account', async () => {
    const { db } = fakeD1([assignment()])
    await expect(resolveGlobalLayer(db, 'user-1', 'PENDING_VERIFICATION', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L1' })
  })

  it('fails before querying for blocked account states', async () => {
    const { db, getQueryCount } = fakeD1([assignment({ roleId: 'admin' })])
    await expect(resolveGlobalLayer(db, 'user-1', 'BANNED', NOW))
      .resolves.toEqual({ decision: 'DENY' })
    expect(getQueryCount()).toBe(0)
  })

  it('filters by the authenticated subject', async () => {
    const { db } = fakeD1([
      assignment({ id: 'other', subjectId: 'user-2', roleId: 'admin' }),
      assignment({ id: 'self', subjectId: 'user-1', roleId: 'user' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L1' })
  })

  it('returns active scoped and global role assignments from the same authoritative read when requested', async () => {
    const { db, getQueryCount } = fakeD1([
      assignment({ id: 'ra-user', roleId: 'user' }),
      assignment({ id: 'ra-org', roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-1' }),
      assignment({ id: 'ra-ip', roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-1' }),
      assignment({ id: 'ra-expired', roleId: 'admin', validUntil: NOW }),
      assignment({ id: 'ra-revoked', roleId: 'admin', status: 'REVOKED' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW, true)).resolves.toEqual({
      decision: 'ALLOW',
      layer: 'L1',
      roleAssignments: [
        { id: 'ra-ip', roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-1' },
        { id: 'ra-org', roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-1' },
        { id: 'ra-user', roleId: 'user', scopeType: 'global', scopeId: null },
      ],
    })
    expect(getQueryCount()).toBe(1)
  })

  it('fails closed on an unknown scoped role when resolving the trusted authorization context', async () => {
    const { db } = fakeD1([
      assignment({ roleId: 'user' }),
      assignment({ id: 'ra-unknown', roleId: 'unlisted_role', scopeType: 'organization', scopeId: 'org-1' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW, true))
      .resolves.toEqual({ decision: 'DENY' })
  })

  it('returns DENY when no eligible global assignment exists', async () => {
    const { db } = fakeD1([
      assignment({ scopeType: 'ip', scopeId: 'ip-9' }),
      assignment({ roleId: 'unknown_role' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })
})


describe('Base user role materialization', () => {
  it('verifies the deterministic role row instead of relying on D1 change metadata', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = []
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            calls.push({ sql, args })
            return { meta: { changes: 2 } }
          },
          first: async () => {
            calls.push({ sql, args })
            return {
              id: 'base-user-user-1',
              subjectId: 'user-1',
              roleId: 'user',
              scopeType: 'global',
              scopeId: null,
              status: 'ACTIVE',
              validFrom: NOW,
              validUntil: null,
            }
          },
        }),
      }),
    } as unknown as D1Database

    await expect(ensureBaseUserRole(db, 'user-1', NOW)).resolves.toBeUndefined()
    expect(calls).toHaveLength(2)
    expect(calls[0].sql).toContain('INSERT OR IGNORE INTO role_assignments')
    expect(calls[0].sql).toContain("'user', 'global'")
    expect(calls[0].args).toEqual(['base-user-user-1', 'user-1', NOW, NOW, NOW])
    expect(calls[1].sql).toContain('SELECT id, subject_id AS subjectId')
    expect(calls[1].args).toEqual(['base-user-user-1'])
  })

  it('rejects a missing persisted base role', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 1 } }),
          first: async () => null,
        }),
      }),
    } as unknown as D1Database

    await expect(ensureBaseUserRole(db, 'user-1', NOW))
      .rejects.toThrow('base role materialization failed validation')
  })

  it('rejects invalid subjects before persistence', async () => {
    const db = {
      prepare: () => {
        throw new Error('persistence must not run')
      },
    } as unknown as D1Database
    await expect(ensureBaseUserRole(db, '', NOW)).rejects.toThrow('invalid subject id')
  })
})


function verifiedUserRoleFixture(
  user: { accountState: string; emailVerified: number | boolean } | null = {
    accountState: 'ACTIVE',
    emailVerified: 1,
  },
  initial: RoleAssignmentRecord | null = null,
) {
  let stored = initial
  let insertCount = 0
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async <T>() => {
          if (sql.includes('FROM "user"')) return user as T | null
          if (sql.includes('FROM role_assignments WHERE id = ?')) {
            return (stored && stored.id === String(args[0]) ? stored : null) as T | null
          }
          throw new Error('unexpected first query: ' + sql)
        },
        run: async () => {
          if (!sql.startsWith('INSERT OR IGNORE INTO role_assignments')) {
            throw new Error('unexpected write query: ' + sql)
          }
          const [id, subjectId, now] = args as [string, string, string, string, string]
          if (
            stored &&
            stored.subjectId === subjectId &&
            stored.roleId === 'verified_user' &&
            stored.scopeType === 'global' &&
            stored.scopeId === null &&
            stored.status === 'ACTIVE'
          ) {
            throw new Error('role assignment effective interval overlaps existing assignment')
          }
          stored = {
            id,
            subjectId,
            roleId: 'verified_user',
            scopeType: 'global',
            scopeId: null,
            status: 'ACTIVE',
            validFrom: now,
            validUntil: null,
            createdAt: now,
            updatedAt: now,
          }
          insertCount += 1
          return { meta: { changes: 1 } }
        },
      }),
    }),
  }
  return {
    db: db as unknown as D1Database,
    getStored: () => stored,
    getInsertCount: () => insertCount,
  }
}

describe('Verified user role materialization', () => {
  it('grants only the canonical global L2 role after account activation and email verification', async () => {
    const fixture = verifiedUserRoleFixture()
    await expect(ensureVerifiedUserRole(fixture.db, 'user-1', NOW)).resolves.toBeUndefined()
    expect(fixture.getStored()).toMatchObject({
      id: 'verified-user-user-1',
      subjectId: 'user-1',
      roleId: 'verified_user',
      scopeType: 'global',
      scopeId: null,
      status: 'ACTIVE',
      validFrom: NOW,
      validUntil: null,
    })
    await expect(resolveGlobalLayer(
      fakeD1([assignment(), fixture.getStored()!]).db,
      'user-1',
      'ACTIVE',
      NOW,
    )).resolves.toEqual({ decision: 'ALLOW', layer: 'L2' })
  })

  it('is idempotent for repeated verification callbacks', async () => {
    const fixture = verifiedUserRoleFixture()
    await ensureVerifiedUserRole(fixture.db, 'user-1', NOW)
    await ensureVerifiedUserRole(fixture.db, 'user-1', NOW)
    expect(fixture.getInsertCount()).toBe(1)
  })

  it('refuses a pending or unverified account and fails closed', async () => {
    const pending = verifiedUserRoleFixture({ accountState: 'PENDING_VERIFICATION', emailVerified: 1 })
    await expect(ensureVerifiedUserRole(pending.db, 'user-1', NOW))
      .rejects.toThrow('verified-user role grant requires an ACTIVE email-verified account')
    expect(pending.getInsertCount()).toBe(0)

    const unverified = verifiedUserRoleFixture({ accountState: 'ACTIVE', emailVerified: 0 })
    await expect(ensureVerifiedUserRole(unverified.db, 'user-1', NOW))
      .rejects.toThrow('verified-user role grant requires an ACTIVE email-verified account')
    expect(unverified.getInsertCount()).toBe(0)
  })

  it('does not silently restore a previously revoked verification role', async () => {
    const fixture = verifiedUserRoleFixture(
      { accountState: 'ACTIVE', emailVerified: 1 },
      assignment({
        id: 'verified-user-user-1',
        roleId: 'verified_user',
        status: 'REVOKED',
      }),
    )
    await expect(ensureVerifiedUserRole(fixture.db, 'user-1', NOW))
      .rejects.toThrow('verified-user role assignment is not currently valid')
    expect(fixture.getInsertCount()).toBe(0)
  })

  it('does not resolve or expose an MFA-protected global admin role before verified MFA enrollment', async () => {
    const { db } = fakeD1([
      assignment({ id: 'ra-user', roleId: 'user' }),
      assignment({ id: 'ra-verified', roleId: 'verified_user' }),
      assignment({ id: 'ra-admin', roleId: 'admin' }),
      assignment({ id: 'ra-super-admin', roleId: 'super_admin' }),
    ], false)

    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW, true)).resolves.toEqual({
      decision: 'ALLOW',
      layer: 'L2',
      roleAssignments: [
        { id: 'ra-user', roleId: 'user', scopeType: 'global', scopeId: null },
        { id: 'ra-verified', roleId: 'verified_user', scopeType: 'global', scopeId: null },
      ],
    })
  })

  it('resolves L8 only after authoritative MFA enrollment is enabled', async () => {
    const { db } = fakeD1([
      assignment({ id: 'ra-user', roleId: 'user' }),
      assignment({ id: 'ra-verified', roleId: 'verified_user' }),
      assignment({ id: 'ra-super-admin', roleId: 'super_admin' }),
    ], true)

    const result = await resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW, true)
    expect(result.decision).toBe('ALLOW')
    expect(result.layer).toBe('L8')
    expect(result.roleAssignments).toContainEqual({
      id: 'ra-super-admin', roleId: 'super_admin', scopeType: 'global', scopeId: null,
    })
  })
})
