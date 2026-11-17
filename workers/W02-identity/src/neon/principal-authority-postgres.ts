import type { Pool } from 'pg'

import type { PrincipalAuthorityStore } from '../auth/principal-store.js'
import { activateEmailVerifiedAccountPostgres } from './email-verification-activation-postgres.js'
import {
  ensureVerifiedUserRolePostgres,
  resolveGlobalLayerPostgres,
} from './role-assignment-postgres.js'

/**
 * PostgreSQL production adapter for W02 principal authority. It composes the
 * existing transactional AUTH-013 activation and PostgreSQL RoleAssignment/MFA
 * reads and is constructed by the Neon-only W02 runtime.
 */
export function createPostgresPrincipalAuthorityStore(pool: Pool): PrincipalAuthorityStore {
  return {
    async activateEmailVerifiedAccount(userId, now) {
      const result = await activateEmailVerifiedAccountPostgres(pool, userId, now)
      return {
        accountState: result.accountState,
        accountStateVersion: result.accountStateVersion,
      }
    },
    ensureVerifiedUserRole: (userId, now) =>
      ensureVerifiedUserRolePostgres(pool, userId, now),
    resolveGlobalLayer: (subjectId, accountState, now, includeRoleAssignments) =>
      resolveGlobalLayerPostgres(pool, subjectId, accountState, now, includeRoleAssignments),
  }
}
