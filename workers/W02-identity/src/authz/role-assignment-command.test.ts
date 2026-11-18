import { describe, expect, it, vi } from 'vitest'

import {
  grantCreatorBusinessRoleWithStore,
  RoleAssignmentCommandError,
  type CreatorRoleGrantCommand,
  type CreatorRoleGrantStore,
} from './role-assignment-command.js'

const command: CreatorRoleGrantCommand = {
  subjectId: 'target-user-0001',
  roleId: 'creator',
  scopeType: 'global',
  scopeId: null,
  approvalRef: 'creator-application-00000000-0000-4000-8000-000000000001',
}

const fixedNow = '2026-10-12T09:30:00.000Z'

describe('W02 provider-neutral creator role grant command', () => {
  it('delegates the exact admitted command and timestamp to the selected Store', async () => {
    const result = {
      assignmentId: 'ra-creator-application-00000000-0000-4000-8000-000000000001',
      roleId: 'creator',
      replayed: false,
    }
    const store: CreatorRoleGrantStore = {
      grant: vi.fn().mockResolvedValue(result),
    }

    await expect(grantCreatorBusinessRoleWithStore(store, command, fixedNow)).resolves.toEqual(result)
    expect(store.grant).toHaveBeenCalledTimes(1)
    expect(store.grant).toHaveBeenCalledWith(command, fixedNow)
  })

  it('preserves deterministic replay results from the selected Store', async () => {
    const result = {
      assignmentId: 'ra-creator-application-00000000-0000-4000-8000-000000000001',
      roleId: 'creator',
      replayed: true,
    }
    const store: CreatorRoleGrantStore = {
      grant: vi.fn().mockResolvedValue(result),
    }

    await expect(grantCreatorBusinessRoleWithStore(store, command, fixedNow)).resolves.toEqual(result)
  })

  it('propagates typed W02 authorization/persistence errors without rewriting them', async () => {
    const error = new RoleAssignmentCommandError(
      'VERIFIED_ROLE_REQUIRED',
      'target must hold an effective L2 verified_user role',
    )
    const store: CreatorRoleGrantStore = {
      grant: vi.fn().mockRejectedValue(error),
    }

    await expect(grantCreatorBusinessRoleWithStore(store, command, fixedNow)).rejects.toBe(error)
  })

  it('propagates unexpected Store failures so the Worker boundary can fail closed', async () => {
    const error = new Error('PostgreSQL unavailable')
    const store: CreatorRoleGrantStore = {
      grant: vi.fn().mockRejectedValue(error),
    }

    await expect(grantCreatorBusinessRoleWithStore(store, command, fixedNow)).rejects.toBe(error)
  })
})
