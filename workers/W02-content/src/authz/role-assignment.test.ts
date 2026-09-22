import { describe, expect, it } from 'vitest'
import { resolveGlobalLayer, type RoleAssignmentRecord } from './role-assignment.js'

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

function fakeD1(rows: RoleAssignmentRecord[]) {
  let queryCount = 0
  const db = {
    prepare: () => ({
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
            ) as T[],
          }
        },
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

  it('fails before querying when account state is not ACTIVE', async () => {
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

  it('returns DENY when no eligible global assignment exists', async () => {
    const { db } = fakeD1([
      assignment({ scopeType: 'ip', scopeId: 'ip-9' }),
      assignment({ roleId: 'unknown_role' }),
    ])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'DENY' })
  })
})
