import type { Pool } from 'pg'

import { buildSessionRevokedEvent } from '../auth/session-revocation-events.js'
import type {
  SessionRevocationStore,
  SessionRevocationStoreInput,
} from '../auth/session-revoke-store.js'
import { revokeUserSessionPostgres } from './session-revocation-postgres.js'

/**
 * PostgreSQL implementation of the AUTH-010 session-revocation command.
 * The existing repository owns the transaction: lock authority/session rows,
 * delete the native session, and insert the audit outbox in one commit.
 *
 * This adapter is only injected by the disposable PostgreSQL rehearsal.
 * The deployed W02 Worker continues to use the D1 store by default.
 */
export function createPostgresSessionRevocationStore(pool: Pool): SessionRevocationStore {
  return {
    async revoke(input: SessionRevocationStoreInput) {
      const event = await buildSessionRevokedEvent({
        sessionId: input.sessionId,
        userId: input.userId,
        occurredAt: new Date().toISOString(),
        correlationId: input.correlationId,
        causationId: input.causationId,
      })

      return revokeUserSessionPostgres(pool, {
        userId: input.userId,
        sessionId: input.sessionId,
        now: input.now,
        event,
      })
    },
  }
}
