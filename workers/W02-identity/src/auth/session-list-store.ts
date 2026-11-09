export type SessionListCursor = {
  createdAt: string
  sessionId: string
}

export type SessionListStoreInput = {
  userId: string
  now: string
  limit: number
  cursor: SessionListCursor | null
}

export type SessionListStoreRow = {
  sessionId: string
  createdAt: string
  expiresAt: string
}

export type SessionListStoreResult = {
  permissionGranted: boolean
  rows: SessionListStoreRow[]
}

/**
 * Read-only persistence boundary for AUTH-010 current-user session listing.
 * The handler authenticates the caller, checks rate limits and applies its
 * response/cursor policy. Stores re-check the effective W02 base-user role
 * and return only non-secret session metadata for the supplied subject.
 */
export interface SessionListStore {
  list(input: SessionListStoreInput): Promise<SessionListStoreResult>
}

type D1SessionListRow = {
  permissionGranted: number | boolean
  sessionId: string | null
  createdAt: string | null
  expiresAt: string | null
}

function assertInput(input: SessionListStoreInput): void {
  if (
    !input ||
    typeof input.userId !== 'string' ||
    input.userId.length < 1 ||
    input.userId.length > 128 ||
    typeof input.now !== 'string' ||
    !Number.isFinite(Date.parse(input.now)) ||
    !Number.isInteger(input.limit) ||
    input.limit < 2 ||
    input.limit > 51
  ) {
    throw new TypeError('invalid AUTH-010 session-list store input')
  }
  if (input.cursor && (
    typeof input.cursor.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(input.cursor.createdAt)) ||
    typeof input.cursor.sessionId !== 'string' ||
    input.cursor.sessionId.length < 1 ||
    input.cursor.sessionId.length > 128
  )) {
    throw new TypeError('invalid AUTH-010 session-list store cursor')
  }
}

/** D1 remains the production default until the complete W02 runtime switch. */
export function createD1SessionListStore(db: D1Database): SessionListStore {
  return {
    async list(input) {
      assertInput(input)
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
            input.limit,
          )
        : statement.bind(input.userId, input.now, input.now, input.userId, input.now, input.limit)
      const result = await bound.all<D1SessionListRow>()
      if (result.success !== true || !Array.isArray(result.results) || result.results.length === 0) {
        throw new Error('SESSION_LIST_SELECT_FAILED')
      }

      const first = result.results[0]
      const rows = result.results.flatMap((row): SessionListStoreRow[] => {
        if (
          typeof row.sessionId !== 'string' ||
          row.sessionId.length === 0 ||
          typeof row.createdAt !== 'string' ||
          typeof row.expiresAt !== 'string'
        ) return []
        return [{
          sessionId: row.sessionId,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        }]
      })
      return {
        permissionGranted: first?.permissionGranted === true || Number(first?.permissionGranted) === 1,
        rows,
      }
    },
  }
}
