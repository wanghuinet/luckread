import type { Pool } from 'pg'

import type {
  SessionListQuery,
  SessionListRow,
  SessionListStore,
  SessionListStoreResult,
} from '../auth/session-list-store.js'

type PostgresSessionRow = {
  permissionGranted: boolean
  sessionId: string | null
  createdAt: Date | string | null
  expiresAt: Date | string | null
}

function assertQuery(input: SessionListQuery): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    new Date(input.now).toISOString() !== input.now ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50
  ) {
    throw new TypeError('invalid PostgreSQL session list query')
  }
  if (input.cursor && (
    typeof input.cursor.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(input.cursor.createdAt)) ||
    typeof input.cursor.sessionId !== 'string' ||
    input.cursor.sessionId.length < 1 ||
    input.cursor.sessionId.length > 128
  )) {
    throw new TypeError('invalid PostgreSQL session list cursor')
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('invalid persisted session timestamp')
  return date.toISOString()
}

/**
 * PostgreSQL implementation of the AUTH-010 bounded session-list query.
 * It only reads sessions for the server-derived subject and rechecks the
 * effective base-user RoleAssignment in the same SQL statement.
 *
 * This is a store adapter for disposable PostgreSQL rehearsal and future
 * staged runtime admission; the deployed Worker still defaults to D1.
 */
export function createPostgresSessionListStore(pool: Pool): SessionListStore {
  return {
    async list(input): Promise<SessionListStoreResult> {
      assertQuery(input)

      const authorization = `
        authorization AS (
          SELECT CASE WHEN EXISTS (
            SELECT 1
            FROM "user" AS account
            INNER JOIN role_assignments AS assignment ON assignment.subject_id = account.id
            WHERE account.id = $1
              AND account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')
              AND assignment.role_id = 'user'
              AND assignment.scope_type = 'global'
              AND assignment.scope_id IS NULL
              AND assignment.status = 'ACTIVE'
              AND assignment.valid_from <= $2
              AND (assignment.valid_until IS NULL OR $3 < assignment.valid_until)
          ) THEN TRUE ELSE FALSE END AS "permissionGranted"
        )`
      const sessions = input.cursor
        ? `sessions AS (
            SELECT id AS "sessionId", created_at AS "createdAt", expires_at AS "expiresAt"
            FROM "session"
            WHERE user_id = $4 AND expires_at > $5
              AND (created_at < $6 OR (created_at = $7 AND id < $8))
            ORDER BY created_at DESC, id DESC
            LIMIT $9
          )`
        : `sessions AS (
            SELECT id AS "sessionId", created_at AS "createdAt", expires_at AS "expiresAt"
            FROM "session"
            WHERE user_id = $4 AND expires_at > $5
            ORDER BY created_at DESC, id DESC
            LIMIT $6
          )`
      const sql = `WITH ${authorization}, ${sessions}
        SELECT authorization."permissionGranted",
          sessions."sessionId", sessions."createdAt", sessions."expiresAt"
        FROM authorization
        LEFT JOIN sessions ON TRUE
        ORDER BY sessions."createdAt" DESC, sessions."sessionId" DESC`
      const values = input.cursor
        ? [
            input.userId,
            input.now,
            input.now,
            input.userId,
            input.now,
            input.cursor.createdAt,
            input.cursor.createdAt,
            input.cursor.sessionId,
            input.limit + 1,
          ]
        : [
            input.userId,
            input.now,
            input.now,
            input.userId,
            input.now,
            input.limit + 1,
          ]

      const result = await pool.query<PostgresSessionRow>(sql, values)
      const permissionGranted = result.rows[0]?.permissionGranted === true
      if (!permissionGranted) return { permissionGranted: false, rows: [] }

      const rows: SessionListRow[] = result.rows.flatMap((row) => {
        if (typeof row.sessionId !== 'string' || row.sessionId.length === 0) return []
        const createdAt = toIso(row.createdAt)
        const expiresAt = toIso(row.expiresAt)
        if (!createdAt || !expiresAt) return []
        return [{ sessionId: row.sessionId, createdAt, expiresAt }]
      })

      return { permissionGranted: true, rows }
    },
  }
}
