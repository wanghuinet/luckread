import type { Pool } from 'pg'

import { buildSessionRevokedEvent } from '../auth/session-revocation-events.js'
import type {
  SessionLogoutStore,
  SessionLogoutStoreInput,
} from '../auth/session-logout-store.js'
import { logoutCurrentSessionPostgres } from './session-logout-postgres.js'

/**
 * PostgreSQL production implementation of the AUTH-010 current-session logout
 * command. The Neon-only W02 runtime constructs this Store from its existing
 * Hyperdrive pool; the disposable PostgreSQL 18 rehearsal uses the same adapter.
 */
export function createPostgresSessionLogoutStore(pool: Pool): SessionLogoutStore {
  return {
    async logout(input: SessionLogoutStoreInput) {
      const event = await buildSessionRevokedEvent({
        sessionId: input.sessionId,
        userId: input.userId,
        operationId: 'authLogout',
        occurredAt: input.now,
        correlationId: input.correlationId,
        causationId: input.causationId,
      })

      return logoutCurrentSessionPostgres(pool, {
        userId: input.userId,
        sessionId: input.sessionId,
        now: input.now,
        event,
      })
    },
  }
}
