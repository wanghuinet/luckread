import type { Pool } from 'pg'

import type {
  SessionListCursor,
  SessionListStore,
  SessionListStoreInput,
  SessionListStoreRow,
} from '../auth/session-list-store.js'

type SessionListPostgresRow = {
  permissionGranted: boolean
  sessionId: string | null
  createdAt: Date | string | null
  expiresAt: Date | string | null
}

function assertInput(input: SessionListStoreInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    new Date(input.now).toISOString() !== input.now ||
    !Number.isInteger(input.limit) ||
    input.limit < 2 ||
    input.limit > 51
  ) {
    throw new TypeError('invalid PostgreSQL AUTH-010 session-list input')
  }

  const cursor: SessionListCursor | null = input.cursor
  if (cursor && (
    typeof cursor.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(cursor.createdAt)) ||
    typeof cursor.sessionId !== 'string' ||
    cursor.sessionId.length < 1 ||
    cursor.sessionId.length > 128
  )) {
    throw new TypeError('invalid PostgreSQL AUTH-010 session-list cursor')
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('invalid PostgreSQL AUTH-010 session timestamp')
  }
  return parsed.toISOString()
}

/**
 * PostgreSQL-native read adapter for AUTH-010.
 *
 * It mirrors the D1 query's keyset pagination and rechecks the authenticated
 * subject's effective base-user RoleAssignment in the same statement. It
 * returns no token, IP, user-agent, or cross-account session fields.
 *
 * This adapter is for disposable PostgreSQL rehearsal and future staged
 * admission. The deployed W02 Worker still uses createD1SessionListStore.
 */
export function createPostgresSessionListStore(pool: Pool): SessionListStore {
  return {
    async list(input: SessionListStoreInput): Promise<SessionListStoreResult> {
      assertInput(input)

      const cursorPredicate = input.cursor
        ? 'AND (created_at < $3 OR (created_at = $4 AND id < $5))'
        : ''
      const limitParameter = input.cursor ? '$6' : '$3'
      const values = input.cursor
        ? [
            input.userId,
            input.now,
            input.cursor.createdAt,
            input.cursor.createdAt,
            input.cursor.sessionId,
            input.limit,
          ]
        : [input.userId, input.now, input.limit]

      const result = await pool.query<SessionListPostgresRow>(
        'WITH authorization AS ( ' +
          'SELECT EXISTS ( ' +
            'SELECT 1 ' +
            'FROM "user" AS account ' +
            'INNER JOIN role_assignments AS assignment ON assignment.subject_id = account.id ' +
            'WHERE account.id = $1 ' +
              "AND account.account_state IN ('PENDING_VERIFICATION', 'ACTIVE') " +
              "AND assignment.role_id = 'user' " +
              "AND assignment.scope_type = 'global' " +
              'AND assignment.scope_id IS NULL ' +
              "AND assignment.status = 'ACTIVE' " +
              'AND assignment.valid_from <= $2 ' +
              'AND (assignment.valid_until IS NULL OR $2 < assignment.valid_until) ' +
          ') AS "permissionGranted" ' +
        '), sessions AS ( ' +
          'SELECT id AS "sessionId", created_at AS "createdAt", expires_at AS "expiresAt" ' +
          'FROM "session" ' +
          'WHERE user_id = $1 AND expires_at > $2 ' +
          cursorPredicate + ' ' +
          'ORDER BY created_at DESC, id DESC ' +
          'LIMIT ' + limitParameter +
        ') ' +
        'SELECT authorization."permissionGranted" AS "permissionGranted", ' +
          'sessions."sessionId" AS "sessionId", ' +
          'sessions."createdAt" AS "createdAt", ' +
          'sessions."expiresAt" AS "expiresAt" ' +
        'FROM authorization LEFT JOIN sessions ON TRUE ' +
        'ORDER BY sessions."createdAt" DESC NULLS LAST, sessions."sessionId" DESC NULLS LAST',
        values,
      )

      if (result.rows.length === 0) {
        throw new Error('AUTH010_POSTGRES_SESSION_LIST_EMPTY_AUTHORITY_RESULT')
      }

      const permissionGranted = result.rows[0]?.permissionGranted === true
      const rows = result.rows.flatMap((row): SessionListStoreRow[] => {
        if (typeof row.sessionId !== 'string' || row.sessionId.length === 0) return []
        const createdAt = toIso(row.createdAt)
        const expiresAt = toIso(row.expiresAt)
        if (!createdAt || !expiresAt) {
          throw new Error('AUTH010_POSTGRES_SESSION_LIST_TIMESTAMP_MISSING')
        }
        return [{ sessionId: row.sessionId, createdAt, expiresAt }]
      })

      return { permissionGranted, rows }
    },
  }
}
