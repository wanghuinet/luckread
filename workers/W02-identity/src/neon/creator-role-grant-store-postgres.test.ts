import type { Pool } from 'pg'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grantCreatorBusinessRolePostgres: vi.fn(),
}))

vi.mock('./role-assignment-postgres.js', () => {
  class RoleAssignmentPostgresError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
      this.name = 'RoleAssignmentPostgresError'
    }
  }
  return {
    grantCreatorBusinessRolePostgres: mocks.grantCreatorBusinessRolePostgres,
    RoleAssignmentPostgresError,
  }
})

import { RoleAssignmentCommandError, type CreatorRoleGrantCommand } from '../authz/role-assignment-command.js'
import { RoleAssignmentPostgresError } from './role-assignment-postgres.js'
import { createPostgresCreatorRoleGrantStore } from './creator-role-grant-store-postgres.js'

const command: CreatorRoleGrantCommand = {
  subjectId: 'target-user-0001',
  roleId: 'creator',
  scopeType: 'global',
  scopeId: null,
  approvalRef: 'creator-application-00000000-0000-4000-8000-000000000001',
}
const fixedNow = '2026-10-12T09:30:00.000Z'
const pool = {} as Pool

describe('W02 PostgreSQL creator-role grant Store', () => {
  beforeEach(() => vi.clearAllMocks())

  it('delegates the admitted global creator grant to the transactional PostgreSQL command', async () => {
    const result = {
      assignmentId: 'ra-creator-application-00000000-0000-4000-8000-000000000001',
      roleId: 'creator',
      replayed: false,
    }
    mocks.grantCreatorBusinessRolePostgres.mockResolvedValue(result)

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow)).resolves.toEqual(result)
    expect(mocks.grantCreatorBusinessRolePostgres).toHaveBeenCalledTimes(1)
    expect(mocks.grantCreatorBusinessRolePostgres).toHaveBeenCalledWith(pool, {
      subjectId: command.subjectId,
      roleId: command.roleId,
      scopeType: command.scopeType,
      scopeId: null,
      approvalRef: command.approvalRef,
    }, fixedNow)
  })

  it('rejects non-global scope before opening a PostgreSQL transaction', async () => {
    await expect(createPostgresCreatorRoleGrantStore(pool).grant({
      ...command,
      scopeId: 'org-1',
    } as unknown as CreatorRoleGrantCommand, fixedNow)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(mocks.grantCreatorBusinessRolePostgres).not.toHaveBeenCalled()
  })

  it('maps typed PostgreSQL authorization errors to the shared W02 command contract', async () => {
    mocks.grantCreatorBusinessRolePostgres.mockRejectedValue(
      new RoleAssignmentPostgresError(
        'VERIFIED_ROLE_REQUIRED',
        'target must hold an effective L2 verified_user role',
      ),
    )

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow))
      .rejects.toBeInstanceOf(RoleAssignmentCommandError)
    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow))
      .rejects.toMatchObject({
        code: 'VERIFIED_ROLE_REQUIRED',
        message: 'target must hold an effective L2 verified_user role',
      })
  })

  it('preserves unexpected infrastructure failures for the Worker boundary', async () => {
    const error = new Error('PostgreSQL unavailable')
    mocks.grantCreatorBusinessRolePostgres.mockRejectedValue(error)

    await expect(createPostgresCreatorRoleGrantStore(pool).grant(command, fixedNow))
      .rejects.toBe(error)
  })
})
