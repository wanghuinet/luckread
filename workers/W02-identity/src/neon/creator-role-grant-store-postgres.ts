import type { Pool } from 'pg'

import {
  RoleAssignmentCommandError,
  type CreatorRoleGrantCommand,
  type CreatorRoleGrantStore,
} from '../authz/role-assignment-command.js'
import {
  grantCreatorBusinessRolePostgres,
  RoleAssignmentPostgresError,
} from './role-assignment-postgres.js'

/**
 * PostgreSQL implementation of the provider-neutral W02 creator-role command.
 * It delegates to the existing single-connection transaction, and maps only
 * its typed persistence errors to the shared W02 command error contract.
 *
 * This adapter is composed by getW02PostgresRuntime and used by the production
 * W02 creator-role grant route. The underlying PostgreSQL command owns the
 * transaction, eligibility checks, deterministic replay and database conflicts.
 */
export function createPostgresCreatorRoleGrantStore(pool: Pool): CreatorRoleGrantStore {
  return {
    async grant(command: CreatorRoleGrantCommand, now: string) {
      if (command.scopeId !== null) {
        throw new RoleAssignmentCommandError('VALIDATION_FAILED', 'only global creator grants are admitted')
      }

      try {
        return await grantCreatorBusinessRolePostgres(pool, {
          subjectId: command.subjectId,
          roleId: command.roleId,
          scopeType: command.scopeType,
          scopeId: null,
          approvalRef: command.approvalRef,
        }, now)
      } catch (error) {
        if (error instanceof RoleAssignmentPostgresError) {
          throw new RoleAssignmentCommandError(error.code, error.message)
        }
        throw error
      }
    },
  }
}
