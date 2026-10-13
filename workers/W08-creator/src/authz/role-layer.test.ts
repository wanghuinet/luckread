import { describe, expect, it } from 'vitest'
import { resolvePermissionContext } from './role-layer.js'

type RoleAssignmentRow = {
  roleId: string
  scopeType: string
  scopeId: string | null
}

const NOW = '2026-10-13T12:00:00.000Z'

class FakeStatement {
  values: unknown[] = []

  constructor(private readonly db: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values
    this.db.bindings = values
    return this
  }

  async all<T>() {
    this.db.readCalls++
    return { results: this.db.rows as T[] }
  }
}

class FakeD1 {
  rows: RoleAssignmentRow[] = []
  statements: string[] = []
  bindings: unknown[] = []
  readCalls = 0

  prepare(sql: string) {
    this.statements.push(sql)
    return new FakeStatement(this, sql)
  }
}

function database(rows: RoleAssignmentRow[] = []) {
  const db = new FakeD1()
  db.rows = rows
  return db
}

describe('W08 persisted authorization context', () => {
  it('resolves the highest global layer while retaining only recognized scoped assignments', async () => {
    const db = database([
      { roleId: 'verified_user', scopeType: 'global', scopeId: null },
      { roleId: 'creator', scopeType: 'global', scopeId: null },
      { roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-17' },
      { roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-8' },
      { roleId: 'mcn_editor', scopeType: 'organization', scopeId: 'org-9' },
      { roleId: 'unknown_scoped_role', scopeType: 'organization', scopeId: 'org-10' },
    ])

    await expect(resolvePermissionContext(db as unknown as D1Database, 'user-1', NOW)).resolves.toEqual({
      layer: 'L3',
      scopedRoleAssignments: [
        { roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-17' },
        { roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-8' },
        { roleId: 'mcn_editor', scopeType: 'organization', scopeId: 'org-9' },
      ],
    })
    expect(db.statements).toHaveLength(1)
    expect(db.statements[0]).toContain('FROM role_assignments')
    expect(db.statements[0]).toContain("status = 'ACTIVE'")
    expect(db.statements[0]).toContain('valid_from <= ?')
    expect(db.statements[0]).toContain('(valid_until IS NULL OR ? < valid_until)')
    expect(db.statements[0]).toMatch(/^\s*SELECT\b/i)
    expect(db.statements[0]).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i)
    expect(db.bindings).toEqual(['user-1', NOW, NOW])
    expect(db.readCalls).toBe(1)
  })

  it('fails closed when persisted global role facts contain an unknown role', async () => {
    const db = database([
      { roleId: 'creator', scopeType: 'global', scopeId: null },
      { roleId: 'root_override', scopeType: 'global', scopeId: null },
    ])

    await expect(resolvePermissionContext(db as unknown as D1Database, 'user-1', NOW)).resolves.toBeNull()
  })

  it('does not infer a global layer from scoped assignments alone', async () => {
    const db = database([
      { roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-17' },
      { roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-8' },
    ])

    await expect(resolvePermissionContext(db as unknown as D1Database, 'user-1', NOW)).resolves.toBeNull()
  })

  it('rejects missing subjects and invalid timestamps before querying D1', async () => {
    const db = database([
      { roleId: 'creator', scopeType: 'global', scopeId: null },
    ])

    await expect(resolvePermissionContext(db as unknown as D1Database, '', NOW)).resolves.toBeNull()
    await expect(resolvePermissionContext(db as unknown as D1Database, 'user-1', 'not-a-date')).resolves.toBeNull()
    expect(db.statements).toHaveLength(0)
    expect(db.readCalls).toBe(0)
  })
})
