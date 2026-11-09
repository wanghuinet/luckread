import type { Pool } from 'pg'

import { buildSessionRevokedEvent } from '../auth/session-revocation-events.js'
import type {
  SessionLogoutStore,
  SessionLogoutStoreInput,
} from '../auth/session-logout-store.js'
import { logoutCurrentSessionPostgres } from './session-logout-postgres.js'

/**
 * PostgreSQL implementation of the AUTH-010 current-session logout command.
 * It is injected only by the disposable PostgreSQL 18 rehearsal. The deployed
 * W02 Worker continues to use the D1 store by default.
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
