import { describe, expect, it } from 'vitest'
import { ensureBaseUserRole, resolveGlobalLayer, type RoleAssignmentRecord } from './role-assignment.js'

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

  it('resolves verified_user to the canonical L2 layer', async () => {
    const { db } = fakeD1([assignment({ roleId: 'verified_user' })])
    await expect(resolveGlobalLayer(db, 'user-1', 'ACTIVE', NOW))
      .resolves.toEqual({ decision: 'ALLOW', layer: 'L2' })
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
  it('creates one deterministic global L1 role assignment and verifies the stored row', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = []
    const reads: Array<{ sql: string; args: unknown[] }> = []
    let persisted: Record<string, unknown> | null = null
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => {
            calls.push({ sql, args })
            persisted = {
              id: args[0],
              subjectId: args[1],
              roleId: 'user',
              scopeType: 'global',
              scopeId: null,
              status: 'ACTIVE',
              validUntil: null,
            }
            return { meta: { changes: 1 } }
          },
          first: async <T>() => {
            reads.push({ sql, args })
            return persisted as T | null
          },
        }),
      }),
    } as unknown as D1Database

    await expect(ensureBaseUserRole(db, 'user-1', NOW)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('INSERT OR IGNORE INTO role_assignments')
    expect(calls[0].sql).toContain("'user', 'global'")
    expect(calls[0].args).toEqual(['base-user-user-1', 'user-1', NOW, NOW, NOW])
    expect(reads).toHaveLength(1)
    expect(reads[0].sql).toContain('WHERE id = ?')
    expect(reads[0].args).toEqual(['base-user-user-1'])
  })

  it('does not treat D1 change metadata from trigger effects as ambiguous', async () => {
    const stored = {
      id: 'base-user-user-1',
      subjectId: 'user-1',
      roleId: 'user',
      scopeType: 'global',
      scopeId: null,
      status: 'ACTIVE',
      validUntil: null,
    }
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 2 } }),
          first: async <T>() => stored as T,
        }),
      }),
    } as unknown as D1Database

    await expect(ensureBaseUserRole(db, 'user-1', NOW)).resolves.toBeUndefined()
  })

  it('fails closed when the deterministic assignment id belongs to a different subject', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: 0 } }),
          first: async <T>() => ({
            id: 'base-user-user-1',
            subjectId: 'user-2',
            roleId: 'user',
            scopeType: 'global',
            scopeId: null,
            status: 'ACTIVE',
            validUntil: null,
          }) as T,
        }),
      }),
    } as unknown as D1Database

    await expect(ensureBaseUserRole(db, 'user-1', NOW))
      .rejects.toThrow('base role materialization postcondition failed')
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
