import { beforeEach, describe, expect, it } from 'vitest'
import { grantCreatorBusinessRole, RoleAssignmentCommandError } from './role-assignment-command.js'
import { mayApproveRoleGrant } from './role-grant-approval-policy.js'

type Assignment = {
  id: string
  subject_id: string
  role_id: string
  scope_type: string
  scope_id: string | null
  status: string
  valid_from: string
  valid_until: string | null
}

class MockStatement {
  private values: unknown[] = []
  constructor(private readonly db: MockD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM "user"')) return this.db.user as T | null
    if (this.sql.includes("role_id = 'verified_user'")) return this.db.verified ? { id: 'verified-user-row' } as T : null
    if (this.sql.includes('FROM role_assignments WHERE id = ?')) {
      const row = this.db.assignments.get(String(this.values[0]))
      return row ? {
        id: row.id,
        subjectId: row.subject_id,
        roleId: row.role_id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        status: row.status,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
      } as T : null
    }
    if (this.sql.includes('FROM role_assignments WHERE subject_id = ?')) {
      return this.db.duplicateEffective ? { id: 'already-effective' } as T : null
    }
    return null
  }
  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.includes('INSERT INTO role_assignments')) {
      const [id, subject_id, role_id, scope_type, scope_id, valid_from, created_at, updated_at] = this.values
      this.db.assignments.set(String(id), {
        id: String(id), subject_id: String(subject_id), role_id: String(role_id),
        scope_type: String(scope_type), scope_id: scope_id === null ? null : String(scope_id),
        status: 'ACTIVE', valid_from: String(valid_from), valid_until: null,
      })
      this.db.lastCreatedAt = String(created_at)
      this.db.lastUpdatedAt = String(updated_at)
      return { meta: { changes: 1 } }
    }
    return { meta: { changes: 0 } }
  }
}

class MockD1 {
  user: { accountState: string; emailVerified: number | boolean } | null = {
    accountState: 'ACTIVE', emailVerified: 1,
  }
  verified = true
  duplicateEffective = false
  assignments = new Map<string, Assignment>()
  lastCreatedAt = ''
  lastUpdatedAt = ''
  prepare(sql: string) { return new MockStatement(this, sql) }
}

const command = (overrides: Partial<{
  subjectId: string
  roleId: string
  scopeType: string
  scopeId: string | null
  approvalRef: string
}> = {}) => ({
  subjectId: 'target-user-0001',
  roleId: 'creator' as const,
  scopeType: 'global' as const,
  scopeId: null,
  approvalRef: 'creator-application-00000000-0000-4000-8000-000000000001',
  ...overrides,
}) as Parameters<typeof grantCreatorBusinessRole>[1] as Parameters<typeof grantCreatorBusinessRole>[1]

const fixedNow = '2026-10-12T09:30:00.000Z'

describe('W02 creator role assignment authority', () => {
  let db: MockD1
  beforeEach(() => { db = new MockD1() })

  it('grants global L3 only after active, verified L2 admission and verifies persisted state', async () => {
    const result = await grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow)
    expect(result).toEqual({
      assignmentId: 'ra-creator-application-00000000-0000-4000-8000-000000000001',
      roleId: 'creator',
      replayed: false,
    })
    expect(db.assignments.get(result.assignmentId)).toMatchObject({
      subject_id: 'target-user-0001',
      role_id: 'creator',
      scope_type: 'global',
      scope_id: null,
      status: 'ACTIVE',
      valid_from: fixedNow,
    })
  })

  it('accepts an exact replay without creating another RoleAssignment', async () => {
    const first = await grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow)
    const second = await grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow)
    expect(first.assignmentId).toBe(second.assignmentId)
    expect(second.replayed).toBe(true)
    expect(db.assignments.size).toBe(1)
  })

  it('rejects accounts that have not completed the L2 verified-user grant', async () => {
    db.verified = false
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow))
      .rejects.toMatchObject({ code: 'VERIFIED_ROLE_REQUIRED' })
    expect(db.assignments.size).toBe(0)
  })

  it('rejects inactive or unverified target account state', async () => {
    db.user = { accountState: 'PENDING_VERIFICATION', emailVerified: 0 }
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow))
      .rejects.toMatchObject({ code: 'TARGET_NOT_ELIGIBLE' })
    expect(db.assignments.size).toBe(0)
  })

  it('rejects client-like role/scope escalation and unsupported role pairs', async () => {
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command({
      roleId: 'creator', scopeType: 'organization', scopeId: 'org-1',
    }), fixedNow)).rejects.toBeInstanceOf(RoleAssignmentCommandError)
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command({
      roleId: 'mcn_admin', scopeType: 'global', scopeId: null,
      approvalRef: 'creator-scope-appointment-00000000-0000-4000-8000-000000000002',
    }), fixedNow)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(db.assignments.size).toBe(0)
  })

  it('refuses to reactivate or overwrite an assignment with a reused approval reference', async () => {
    db.assignments.set('ra-creator-application-00000000-0000-4000-8000-000000000001', {
      id: 'ra-creator-application-00000000-0000-4000-8000-000000000001',
      subject_id: 'target-user-0001', role_id: 'creator', scope_type: 'global', scope_id: null,
      status: 'REVOKED', valid_from: fixedNow, valid_until: null,
    })
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command(), fixedNow))
      .rejects.toMatchObject({ code: 'ROLE_ASSIGNMENT_CONFLICT' })
    expect(db.assignments.get('ra-creator-application-00000000-0000-4000-8000-000000000001')?.status).toBe('REVOKED')
  })

  it('refuses timestamps that cannot yield an effective assignment', async () => {
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command(), 'not-a-date'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('permits creator grants only when scope is global and empty', async () => {
    await expect(grantCreatorBusinessRole(db as unknown as D1Database, command({
      roleId: 'creator', scopeType: 'organization', scopeId: 'org-1',
    }), fixedNow)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(db.assignments.size).toBe(0)
  })
})
