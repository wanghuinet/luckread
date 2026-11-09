import { buildSessionRevocationOutboxInsert, buildSessionRevokedEvent } from './session-revocation-events.js'
import type { SessionRevokedEvent } from './session-revocation-events.js'

export type SessionRevocationStoreInput = {
  userId: string
  sessionId: string
  now: string
  correlationId?: string | null
  causationId?: string | null
}

export type SessionRevocationStoreResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }
  | { status: 'PERMISSION_DENIED' }

export interface SessionRevocationStore {
  revoke(input: SessionRevocationStoreInput): Promise<SessionRevocationStoreResult>
}

type D1SessionRevocationTarget = {
  permissionGranted: number
  id: string | null
  userId: string | null
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function assertInput(input: SessionRevocationStoreInput): void {
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
    throw new TypeError('invalid AUTH-010 session revocation store input')
  }
}

/**
 * D1 remains the production-default AUTH-010 session revocation repository.
 * It resolves effective L1 authority, checks target ownership, and batches
 * native-session deletion with the durable audit outbox insertion.
 */
export function createD1SessionRevocationStore(db: D1Database): SessionRevocationStore {
  return {
    async revoke(input) {
      assertInput(input)

      const target = await db.prepare(`
        WITH authorization AS (
          SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM "user" AS account
            INNER JOIN role_assignments AS assignment ON assignment.subject_id = account.id
            WHERE account.id = ?
              AND account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')
              AND assignment.role_id = 'user'
              AND assignment.scope_type = 'global'
              AND assignment.scope_id IS NULL
              AND assignment.status = 'ACTIVE'
              AND assignment.valid_from <= ?
              AND (assignment.valid_until IS NULL OR ? < assignment.valid_until)
          ) THEN 1 ELSE 0 END AS permissionGranted
        )
        SELECT authorization.permissionGranted,
          target.id, target.user_id AS userId
        FROM authorization
        LEFT JOIN "session" AS target
          ON authorization.permissionGranted = 1
          AND target.id = ?
          AND target.user_id = ?
      `)
        .bind(input.userId, input.now, input.now, input.sessionId, input.userId)
        .first<D1SessionRevocationTarget>()

      if (!target) throw new Error('SESSION_REVOKE_AUTHORIZATION_READ_FAILED')
      if (Number(target.permissionGranted) !== 1) return { status: 'PERMISSION_DENIED' }
      if (!target.id || String(target.userId) !== input.userId) {
        return { status: 'NOT_FOUND_OR_NOT_OWNED' }
      }

      const event: SessionRevokedEvent = await buildSessionRevokedEvent({
        sessionId: target.id,
        userId: input.userId,
        occurredAt: new Date().toISOString(),
        correlationId: input.correlationId,
        causationId: input.causationId,
      })

      const committed = await db.batch([
        db.prepare(`
          DELETE FROM "session"
          WHERE id = ? AND user_id = ?
            AND EXISTS (
              SELECT 1
              FROM "user" AS account
              INNER JOIN role_assignments AS assignment ON assignment.subject_id = account.id
              WHERE account.id = ?
                AND account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')
                AND assignment.role_id = 'user'
                AND assignment.scope_type = 'global'
                AND assignment.scope_id IS NULL
                AND assignment.status = 'ACTIVE'
                AND assignment.valid_from <= ?
                AND (assignment.valid_until IS NULL OR ? < assignment.valid_until)
            )
        `).bind(target.id, input.userId, input.userId, input.now, input.now),
        buildSessionRevocationOutboxInsert(db, event),
      ])

      const deleted = committed[0]
      const journaled = committed[1]
      if (deleted?.success !== true || journaled?.success !== true) {
        throw new Error('SESSION_REVOKE_AUDIT_BATCH_FAILED')
      }

      const deleteCount = Number(deleted.meta?.changes ?? 0)
      const journalCount = Number(journaled.meta?.changes ?? 0)
      if (deleteCount === 0 && journalCount === 0) {
        // A concurrent request may have already removed this target. Its
        // atomic batch owns the one logical event; this retry is a no-op.
        return { status: 'NOT_FOUND_OR_NOT_OWNED' }
      }
      if (deleteCount !== 1 || journalCount !== 1) {
        throw new Error('SESSION_REVOKE_AUDIT_BATCH_INCOMPLETE')
      }

      return { status: 'REVOKED' }
    },
  }
}
