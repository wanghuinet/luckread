import {
  buildSessionRevocationOutboxInsert,
  buildSessionRevokedEvent,
} from './session-revocation-events.js'

export type SessionLogoutStoreInput = {
  userId: string
  sessionId: string
  now: string
  correlationId?: string | null
  causationId?: string | null
}

export type SessionLogoutStoreResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }

export interface SessionLogoutStore {
  logout(input: SessionLogoutStoreInput): Promise<SessionLogoutStoreResult>
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function assertInput(input: SessionLogoutStoreInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    !RESOURCE_ID.test(input.userId) ||
    typeof input.sessionId !== 'string' ||
    !RESOURCE_ID.test(input.sessionId) ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    new Date(input.now).toISOString() !== input.now
  ) {
    throw new TypeError('invalid AUTH-010 session logout store input')
  }
}

/**
 * D1 remains the production-default current-session logout repository.
 * The native session deletion and USER_LOGOUT audit outbox row commit in one
 * D1 batch. A concurrent/replayed logout is a no-op and cannot add a second
 * event for the same Session resource.
 */
export function createD1SessionLogoutStore(db: D1Database): SessionLogoutStore {
  return {
    async logout(input: SessionLogoutStoreInput): Promise<SessionLogoutStoreResult> {
      assertInput(input)

      const event = await buildSessionRevokedEvent({
        sessionId: input.sessionId,
        userId: input.userId,
        operationId: 'authLogout',
        occurredAt: input.now,
        correlationId: input.correlationId,
        causationId: input.causationId,
      })

      const committed = await db.batch([
        db.prepare(
          'DELETE FROM "session" WHERE id = ? AND user_id = ?',
        ).bind(input.sessionId, input.userId),
        buildSessionRevocationOutboxInsert(db, event),
      ])

      const deleted = committed[0]
      const journaled = committed[1]
      if (deleted?.success !== true || journaled?.success !== true) {
        throw new Error('SESSION_LOGOUT_AUDIT_BATCH_FAILED')
      }
      if (!Number.isInteger(deleted.meta?.changes) || !Number.isInteger(journaled.meta?.changes)) {
        throw new Error('SESSION_LOGOUT_AUDIT_BATCH_METADATA_MISSING')
      }

      const deletedChanges = deleted.meta.changes
      const journaledChanges = journaled.meta.changes
      if (deletedChanges === 1 && journaledChanges === 1) return { status: 'REVOKED' }
      if (deletedChanges === 0 && journaledChanges === 0) {
        return { status: 'NOT_FOUND_OR_NOT_OWNED' }
      }
      throw new Error('SESSION_LOGOUT_AUDIT_BATCH_INCOMPLETE')
    },
  }
}
