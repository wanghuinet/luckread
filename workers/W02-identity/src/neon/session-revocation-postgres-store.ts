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
 * The Neon-only W02 production runtime constructs this Store from its existing
 * Hyperdrive pool; the disposable PostgreSQL 18 rehearsal uses the same adapter.
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
