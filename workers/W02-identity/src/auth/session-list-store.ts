export type SessionListCursor = {
  createdAt: string
  sessionId: string
}

export type SessionListQuery = {
  userId: string
  now: string
  limit: number
  cursor: SessionListCursor | null
}

export type SessionListRow = {
  sessionId: string
  createdAt: string
  expiresAt: string
}

export type SessionListStoreResult = {
  permissionGranted: boolean
  rows: SessionListRow[]
}

export interface SessionListStore {
  list(input: SessionListQuery): Promise<SessionListStoreResult>
}

type D1SessionListRow = {
  permissionGranted: number | boolean
  sessionId: string | null
  createdAt: string | null
  expiresAt: string | null
}

function assertQuery(input: SessionListQuery): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 50
  ) {
    throw new TypeError('invalid session list query')
  }
  if (input.cursor && (
    typeof input.cursor.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(input.cursor.createdAt)) ||
    typeof input.cursor.sessionId !== 'string' ||
    input.cursor.sessionId.length < 1 ||
    input.cursor.sessionId.length > 128
  )) {
    throw new TypeError('invalid session list cursor')
  }
}

/**
 * D1 remains the production-default AUTH-010 session-list repository.
 * The effective base-user RoleAssignment and native Better Auth sessions are
 * checked in one bounded query, with a single look-ahead row for pagination.
 */
export function createD1SessionListStore(db: D1Database): SessionListStore {
  return {
    async list(input) {
      assertQuery(input)

      const authorizationCte = `
        authorization AS (
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
        )`
      const sessionCte = input.cursor
        ? `sessions AS (
            SELECT id AS sessionId, created_at AS createdAt, expires_at AS expiresAt
            FROM "session"
            WHERE user_id = ? AND expires_at > ?
              AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )`
        : `sessions AS (
            SELECT id AS sessionId, created_at AS createdAt, expires_at AS expiresAt
            FROM "session"
            WHERE user_id = ? AND expires_at > ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )`
      const sql = `WITH ${authorizationCte}, ${sessionCte}
        SELECT authorization.permissionGranted,
          sessions.sessionId, sessions.createdAt, sessions.expiresAt
        FROM authorization
        LEFT JOIN sessions ON 1 = 1
        ORDER BY sessions.createdAt DESC, sessions.sessionId DESC`

      const statement = db.prepare(sql)
      const bound = input.cursor
        ? statement.bind(
            input.userId,
            input.now,
            input.now,
            input.userId,
            input.now,
            input.cursor.createdAt,
            input.cursor.createdAt,
            input.cursor.sessionId,
            input.limit + 1,
          )
        : statement.bind(
            input.userId,
            input.now,
            input.now,
            input.userId,
            input.now,
            input.limit + 1,
          )
      const result = await bound.all<D1SessionListRow>()

      // A D1 SELECT may resolve with success=false; never hide a storage
      // failure behind an empty session list.
      if (result.success !== true || !Array.isArray(result.results) || result.results.length === 0) {
        throw new Error('SESSION_LIST_SELECT_FAILED')
      }

      const permissionGranted = Number(result.results[0]?.permissionGranted) === 1
      if (!permissionGranted) return { permissionGranted: false, rows: [] }

      const rows = result.results.flatMap((row) => {
        if (
          typeof row.sessionId !== 'string' ||
          row.sessionId.length === 0 ||
          typeof row.createdAt !== 'string' ||
          typeof row.expiresAt !== 'string'
        ) return []
        return [{ sessionId: row.sessionId, createdAt: row.createdAt, expiresAt: row.expiresAt }]
      })

      return { permissionGranted: true, rows }
    },
  }
}
