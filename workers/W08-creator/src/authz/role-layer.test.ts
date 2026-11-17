import { describe, expect, it, vi } from 'vitest'

import { resolvePermissionContextPostgres } from './role-layer.js'

type RoleAssignmentRow = {
  roleId: string
  scopeType: string
  scopeId: string | null
}

const NOW = '2026-10-13T12:00:00.000Z'

describe('W08 Neon PostgreSQL role context adapter', () => {
  it('uses active/time-valid role facts, deterministic order and scoped role mapping', async () => {
    const query = vi.fn(async (sql: string, values: unknown[]) => {
      expect(sql).toContain('FROM role_assignments')
      expect(sql).toContain("status = 'ACTIVE'")
      expect(sql).toContain('valid_from <= $2')
      expect(sql).toContain('(valid_until IS NULL OR $3 < valid_until)')
      expect(sql).toContain('ORDER BY role_id ASC, id ASC')
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i)
      expect(values).toEqual(['user-1', NOW, NOW])
      return [
        { roleId: 'verified_user', scopeType: 'global', scopeId: null },
        { roleId: 'creator', scopeType: 'global', scopeId: null },
        { roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-17' },
        { roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-8' },
        { roleId: 'ignored_scoped_role', scopeType: 'organization', scopeId: 'org-9' },
      ]
    })

    await expect(resolvePermissionContextPostgres(query, 'user-1', NOW)).resolves.toEqual({
      layer: 'L3',
      scopedRoleAssignments: [
        { roleId: 'ip_principal', scopeType: 'ip', scopeId: 'ip-17' },
        { roleId: 'mcn_admin', scopeType: 'organization', scopeId: 'org-8' },
      ],
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('fails closed for unknown global roles and invalid lookups without a SQL query', async () => {
    const query = vi.fn(async () => [
      { roleId: 'root_override', scopeType: 'global', scopeId: null },
    ])
    await expect(resolvePermissionContextPostgres(query, 'user-1', NOW)).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)

    const invalidQuery = vi.fn()
    await expect(resolvePermissionContextPostgres(invalidQuery, '', NOW)).resolves.toBeNull()
    await expect(resolvePermissionContextPostgres(invalidQuery, 'user-1', 'invalid-time')).resolves.toBeNull()
    expect(invalidQuery).not.toHaveBeenCalled()
  })
})
