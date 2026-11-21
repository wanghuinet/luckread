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
 * The existing PostgreSQL transaction intentionally supports only moderator /
 * admin transitions without a separate approval receipt. Self-service,
 * lifecycle-job and approval-required transitions remain on their dedicated
 * adapters and fail closed here. The Neon-only W02 production runtime uses this
 * Store for moderator/admin transitions; the PostgreSQL rehearsal exercises
 * the same implementation.
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
