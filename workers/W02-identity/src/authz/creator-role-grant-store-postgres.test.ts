import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { CreatorRoleGrantCommand } from './role-assignment-command.js'
import { createPostgresCreatorRoleGrantStore } from '../neon/creator-role-grant-store-postgres.js'

const command: CreatorRoleGrantCommand = {
  subjectId: 'target-user-0001',
  roleId: 'creator',
  scopeType: 'global',
  scopeId: null,
  approvalRef: 'creator-application-00000000-0000-4000-8000-000000000001',
}
const fixedNow = '2026-10-12T09:30:00.000Z'
const assignmentId = 'ra-' + command.approvalRef

const makeClient = (query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>) => ({
  query: vi.fn(query),
  release: vi.fn(),
})

describe('W02 PostgreSQL creator-role grant Store', () => {
  it('uses one PostgreSQL transaction to persist an eligible global creator grant', async () => {
    let assignmentReads = 0
    const client = makeClient(async (sql, values) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('INSERT')) {
        return { rows: [] }
      }
      if (sql.includes('FROM "user"')) {
        return { rows: [{ accountState: 'ACTIVE', emailVerified: true }] }
      }
      if (sql.includes("role_id = 'verified_user'")) {
        return { rows: [{ id: 'verified-user-target-user-0001' }] }
      }
      if (sql.includes('FROM role_assignments WHERE id = $1 LIMIT 1')) {
        assignmentReads += 1
        return {
          rows: assignmentReads === 1
            ? []
            : [{
                id: assignmentId,
                subjectId: command.subjectId,
                roleId: 'creator',
                scopeType: 'global',
                scopeId: null,
                status: 'ACTIVE',
                validFrom: fixedNow,
                validUntil: null,
              }],
        }
      }
      if (sql.includes('FROM role_assignments WHERE subject_id = $1 AND role_id = $2')) {
        return { rows: [] }
      }
      throw new Error('unexpected creator-role PostgreSQL query: ' + sql)
    })
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow)).resolves.toEqual({
      assignmentId,
      roleId: 'creator',
      replayed: false,
    })

    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(client.query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "user" WHERE id = $1'),
      [command.subjectId],
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("role_id = 'verified_user'"),
      [command.subjectId, fixedNow, fixedNow],
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_assignments'),
      [assignmentId, command.subjectId, fixedNow],
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('returns deterministic replay without inserting a second assignment', async () => {
    const client = makeClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('FROM "user"')) {
        return { rows: [{ accountState: 'ACTIVE', emailVerified: true }] }
      }
      if (sql.includes("role_id = 'verified_user'")) {
        return { rows: [{ id: 'verified-user-target-user-0001' }] }
      }
      if (sql.includes('FROM role_assignments WHERE id = $1 LIMIT 1')) {
        return {
          rows: [{
            id: assignmentId,
            subjectId: command.subjectId,
            roleId: 'creator',
            scopeType: 'global',
            scopeId: null,
            status: 'ACTIVE',
            validFrom: fixedNow,
            validUntil: null,
          }],
        }
      }
      throw new Error('unexpected creator-role PostgreSQL query: ' + sql)
    })
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow)).resolves.toEqual({
      assignmentId,
      roleId: 'creator',
      replayed: true,
    })
    expect(client.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT'))).toBe(false)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rejects non-global scope before opening a PostgreSQL transaction', async () => {
    const pool = { connect: vi.fn() } as unknown as Pool

    await expect(createPostgresCreatorRoleGrantStore(pool).grant({
      ...command,
      scopeId: 'org-1',
    } as unknown as CreatorRoleGrantCommand, fixedNow)).rejects.toMatchObject({
      name: 'RoleAssignmentCommandError',
      code: 'VALIDATION_FAILED',
    })
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('maps typed PostgreSQL authorization errors and rolls back the transaction', async () => {
    const client = makeClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] }
      if (sql.includes('FROM "user"')) {
        return { rows: [{ accountState: 'ACTIVE', emailVerified: true }] }
      }
      if (sql.includes("role_id = 'verified_user'")) return { rows: [] }
      throw new Error('unexpected creator-role PostgreSQL query: ' + sql)
    })
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow)).rejects.toMatchObject({
      name: 'RoleAssignmentCommandError',
      code: 'VERIFIED_ROLE_REQUIRED',
      message: 'target must hold an effective L2 verified_user role',
    })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('maps unexpected PostgreSQL infrastructure failures to a sanitized W02 command error', async () => {
    const error = new Error('PostgreSQL unavailable')
    const client = makeClient(async () => Promise.reject(error))
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow))
      .rejects.toMatchObject({
        name: 'RoleAssignmentCommandError',
        code: 'ROLE_ASSIGNMENT_WRITE_FAILED',
        message: 'role assignment could not be committed',
      })
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})
