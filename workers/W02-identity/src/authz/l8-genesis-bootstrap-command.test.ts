import { describe, expect, it } from 'vitest'
import { bootstrapSuperAdmin, L8BootstrapCommandError } from './l8-genesis-bootstrap-command.js'
import type { VerifiedL8BootstrapApproval } from './l8-genesis-bootstrap-approval.js'

type UserRow = { accountState: string; emailVerified: number | boolean }
type Assignment = {
  id: string; subjectId: string; roleId: string; scopeType: string; scopeId: string | null
  status: string; validFrom: string; validUntil: string | null
}
type Audit = {
  requestPrNumber: number; requestHeadSha: string; requestMergeSha: string; targetUserId: string
  assignmentId: string; nonceSha256: string; validFrom: string; validUntil: string
  operation: string; approvedReviewers: string; reviewerPermissions: string; workflowRunId: string
}

class Statement {
  private values: unknown[] = []
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }

  async first<T>(): Promise<T | null> {
    const v = this.values
    if (this.sql.includes('FROM role_authorization_versions')) {
      const row = this.db.roleVersions.get(String(v[0]))
      return (row ? { roleVersion: row.roleVersion } : null) as T | null
    }
    if (this.sql.includes('FROM "user"')) return this.db.user as T | null
    if (this.sql.includes("role_id = 'verified_user'")) {
      return this.db.assignments.some((row) =>
        row.subjectId === v[0] && row.roleId === 'verified_user' && row.scopeType === 'global' &&
        row.scopeId === null && row.status === 'ACTIVE' && row.validFrom <= String(v[1]) &&
        (row.validUntil === null || String(v[2]) < row.validUntil),
      ) ? { id: 'verified-user-row' } as T : null
    }
    if (this.sql.includes("role_id = 'super_admin'")) {
      return this.db.assignments.some((row) =>
        row.roleId === 'super_admin' && row.scopeType === 'global' && row.scopeId === null &&
        row.status === 'ACTIVE' && row.validFrom <= String(v[0]) &&
        (row.validUntil === null || String(v[1]) < row.validUntil),
      ) ? { id: 'existing-l8' } as T : null
    }
    if (this.sql.includes('FROM l8_genesis_bootstrap_audit')) {
      if (!this.db.audit) return null
      if (this.sql.includes('role_assignment_id AS assignmentId')) return { assignmentId: this.db.audit.assignmentId } as T
      return this.db.audit as T
    }
    if (this.sql.includes('FROM role_assignments WHERE id = ?')) {
      return (this.db.assignments.find((row) => row.id === v[0]) ?? null) as T | null
    }
    return null
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.includes('INSERT INTO role_authorization_versions')) {
      const [subjectId, updatedAt] = this.values
      const key = String(subjectId)
      const current = this.db.roleVersions.get(key)
      this.db.roleVersions.set(key, {
        roleVersion: current ? current.roleVersion + 1 : 1,
        updatedAt: String(updatedAt),
      })
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes('INSERT INTO l8_genesis_bootstrap_audit')) {
      if (this.db.audit) throw new Error('bootstrap singleton consumed')
      const [bootstrapKey, operation, requestPrNumber, requestHeadSha, requestMergeSha, targetUserId,
        assignmentId, nonceSha256, approvedReviewers, reviewerPermissions, workflowRunId, validFrom,
        validUntil, createdAt] = this.values
      if (bootstrapKey !== 'first-l8') throw new Error('bad key')
      this.db.audit = {
        requestPrNumber: Number(requestPrNumber), requestHeadSha: String(requestHeadSha),
        requestMergeSha: String(requestMergeSha), targetUserId: String(targetUserId),
        assignmentId: String(assignmentId), nonceSha256: String(nonceSha256),
        validFrom: String(validFrom), validUntil: String(validUntil), operation: String(operation),
        approvedReviewers: String(approvedReviewers), reviewerPermissions: String(reviewerPermissions),
        workflowRunId: String(workflowRunId),
      }
      void createdAt
      return { meta: { changes: 1 } }
    }
    if (this.sql.includes('INSERT INTO role_assignments')) {
      const [id, subjectId, validFrom, validUntil] = this.values
      if (this.db.assignments.some((row) => row.id === id || (row.roleId === 'super_admin' && row.subjectId === subjectId && row.status === 'ACTIVE'))) {
        throw new Error('assignment duplicate')
      }
      this.db.assignments.push({
        id: String(id), subjectId: String(subjectId), roleId: 'super_admin', scopeType: 'global',
        scopeId: null, status: 'ACTIVE', validFrom: String(validFrom), validUntil: String(validUntil),
      })
    }
    return { meta: { changes: 1 } }
  }
}

class FakeD1 {
  user: UserRow | null = { accountState: 'ACTIVE', emailVerified: 1 }
  assignments: Assignment[] = [{
    id: 'verified-user-target-123', subjectId: 'existing-user-123', roleId: 'verified_user',
    scopeType: 'global', scopeId: null, status: 'ACTIVE', validFrom: '2026-10-01T00:00:00.000Z',
    validUntil: null,
  }]
  audit: Audit | null = null
  roleVersions = new Map<string, { roleVersion: number; updatedAt: string }>()
  prepare(sql: string) { return new Statement(this, sql) }
  async batch(statements: Statement[]) {
    const beforeAudit = this.audit
    const beforeAssignments = [...this.assignments]
    const beforeRoleVersions = new Map(this.roleVersions)
    try {
      for (const statement of statements) await statement.run()
    } catch (error) {
      this.audit = beforeAudit
      this.assignments = beforeAssignments
      this.roleVersions = beforeRoleVersions
      throw error
    }
    return []
  }
}

const NOW = '2026-10-24T12:00:00.000Z'
const approval = (overrides: Partial<VerifiedL8BootstrapApproval> = {}): VerifiedL8BootstrapApproval => ({
  request: {
    version: 1,
    operation: 'INITIAL_L8_BOOTSTRAP',
    targetUserId: 'existing-user-123',
    roleId: 'super_admin',
    scopeType: 'global',
    scopeId: null,
    reason: 'First L8 grant under approved change-control request',
    nonce: 'c'.repeat(64),
    createdAt: '2026-10-24T11:50:00.000Z',
    expiresAt: '2026-10-24T13:00:00.000Z',
  },
  requestPrNumber: 77,
  requestHeadSha: 'a'.repeat(40),
  requestMergeSha: 'b'.repeat(40),
  approvedReviewers: ['maintainer-a', 'maintainer-b'],
  reviewerPermissions: { 'maintainer-a': 'maintain', 'maintainer-b': 'write' },
  workflowRunId: '12345678',
  ...overrides,
})

describe('W02 one-time L8 genesis grant command', () => {
  it('writes a global super_admin assignment with a four-hour limit and permanent audit guard', async () => {
    const db = new FakeD1()
    const result = await bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW)
    expect(result).toMatchObject({
      targetUserId: 'existing-user-123',
      roleId: 'super_admin',
      validFrom: NOW,
      validUntil: '2026-10-24T16:00:00.000Z',
      replayed: false,
    })
    expect(db.assignments).toContainEqual(expect.objectContaining({
      id: result.assignmentId, subjectId: 'existing-user-123', roleId: 'super_admin',
      scopeType: 'global', scopeId: null, validUntil: result.validUntil,
    }))
    expect(db.roleVersions.get('existing-user-123')).toEqual({ roleVersion: 1, updatedAt: NOW })
    expect(result.roleVersion).toBe(1)
    expect(db.audit).toMatchObject({
      requestPrNumber: 77,
      requestHeadSha: 'a'.repeat(40),
      requestMergeSha: 'b'.repeat(40),
      targetUserId: 'existing-user-123',
      assignmentId: result.assignmentId,
      operation: 'INITIAL_L8_BOOTSTRAP',
      workflowRunId: '12345678',
    })
  })

  it('accepts an exact successful replay without creating another assignment', async () => {
    const db = new FakeD1()
    const first = await bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW)
    const second = await bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW)
    expect(second.assignmentId).toBe(first.assignmentId)
    expect(second.replayed).toBe(true)
    expect(second.roleVersion).toBe(1)
    expect(db.roleVersions.get('existing-user-123')?.roleVersion).toBe(1)
    expect(db.assignments.filter((row) => row.roleId === 'super_admin')).toHaveLength(1)
  })

  it('permanently refuses a different request after the one-time guard is consumed', async () => {
    const db = new FakeD1()
    await bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW)
    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval({
      requestPrNumber: 78,
      requestHeadSha: 'd'.repeat(40),
      requestMergeSha: 'e'.repeat(40),
      request: { ...approval().request, nonce: 'f'.repeat(64) },
    }), NOW)).rejects.toMatchObject({ code: 'BOOTSTRAP_ALREADY_CONSUMED' })
  })

  it('rejects an inactive or unverified target account', async () => {
    const db = new FakeD1()
    db.user = { accountState: 'PENDING_VERIFICATION', emailVerified: 0 }
    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW))
      .rejects.toMatchObject({ code: 'TARGET_NOT_ELIGIBLE' })
    expect(db.audit).toBeNull()
    expect(db.assignments.filter((row) => row.roleId === 'super_admin')).toHaveLength(0)
  })

  it('rejects targets without an effective L2 verified_user assignment', async () => {
    const db = new FakeD1()
    db.assignments = []
    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW))
      .rejects.toMatchObject({ code: 'VERIFIED_ROLE_REQUIRED' })
  })

  it('refuses the genesis route if an effective global L8 already exists', async () => {
    const db = new FakeD1()
    db.assignments.push({
      id: 'legacy-l8', subjectId: 'another-user-123', roleId: 'super_admin', scopeType: 'global',
      scopeId: null, status: 'ACTIVE', validFrom: '2026-10-24T11:00:00.000Z',
      validUntil: '2026-10-24T18:00:00.000Z',
    })
    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval(), NOW))
      .rejects.toMatchObject({ code: 'L8_ALREADY_EXISTS' })
  })

  it('rejects expired approvals and malformed two-person evidence', async () => {
    const db = new FakeD1()
    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval({
      request: { ...approval().request, expiresAt: '2026-10-24T11:59:59.000Z' },
    }), NOW)).rejects.toMatchObject({ code: 'REQUEST_EXPIRED_OR_INVALID' })

    await expect(bootstrapSuperAdmin(db as unknown as D1Database, approval({
      approvedReviewers: ['maintainer-a', 'maintainer-a'],
    }), NOW)).rejects.toBeInstanceOf(L8BootstrapCommandError)
  })
})
