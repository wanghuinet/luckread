import type { Pool } from 'pg'

import {
  AccountStateTransitionError,
} from '../account/account-state-transition.js'
import type {
  AccountStateTransitionStore,
} from '../account/account-state-transition-store.js'
import {
  AccountStateTransitionPostgresError,
  applyModeratorAccountStateTransitionPostgres,
} from './account-state-transition-postgres.js'

/**
 * PostgreSQL implementation of the provider-neutral W02 transition contract.
 *
 * Permissionless self-service and no-approval moderator/admin transitions are
 * admitted. System lifecycle operations, unproven lifecycle preconditions, and
 * approval-required transitions remain on dedicated W02 paths and fail closed.
 * The PostgreSQL rehearsal exercises the same implementation used by Neon runtime.
 */
export function createPostgresAccountStateTransitionStore(
  pool: Pool,
): AccountStateTransitionStore {
  return {
    async transition(command) {
      try {
        return await applyModeratorAccountStateTransitionPostgres(pool, command)
      } catch (error) {
        if (error instanceof AccountStateTransitionPostgresError) {
          throw new AccountStateTransitionError(error.code, error.message)
        }
        throw error
      }
    },
  }
}
