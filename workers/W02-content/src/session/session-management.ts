import permissions from '../../../../contracts/authz/permissions.json'
import layers from '../../../../contracts/authz/layers.json'

type PermissionDefinition = {
  name: string
  minLayer?: string
}

type SessionListRow = {
  sessionId: string
  deviceId: string | null
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
}

export class SessionManagementError extends Error {
  constructor(
    readonly code: 'UNAUTHENTICATED' | 'PERMISSION_DENIED' | 'INVALID_INPUT' | 'INVALID_CURSOR' | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

const permissionMinLayer = new Map(
  ((permissions['x-permissions'] ?? []) as PermissionDefinition[])
    .filter((entry) => typeof entry.name === 'string' && typeof entry.minLayer === 'string')
    .map((entry) => [entry.name, entry.minLayer as string]),
)

const rolesByMinimumLayer = (permissionName: string): string[] => {
  const minLayer = permissionMinLayer.get(permissionName)
  if (!minLayer || !/^L[0-8]$/.test(minLayer)) return []
  const minimum = Number(minLayer.slice(1))
  const result: string[] = []
  for (const layer of layers['x-layers']) {
    const layerNumber = Number(layer.id.slice(1))
    if (layerNumber < minimum) continue
    for (const role of layer.roles ?? []) result.push(role)
  }
  return [...new Set(result)]
}

const SESSION_READ_ROLES = rolesByMinimumLayer('user.session.read')
const SESSION_REVOKE_ROLES = rolesByMinimumLayer('user.session.revoke')

function assertSubjectId(subjectId: string): void {
  if (typeof subjectId !== 'string' || subjectId.length < 1 || subjectId.length > 128) {
    throw new SessionManagementError('INVALID_INPUT', 'subjectId is required')
  }
}

function assertTokenVersion(tokenVersion: number): void {
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new SessionManagementError('INVALID_INPUT', 'tokenVersion is invalid')
  }
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 128) {
    throw new SessionManagementError('INVALID_INPUT', 'sessionId is invalid')
  }
}

function encodeCursor(row: Pick<SessionListRow, 'sessionId' | 'createdAt'>): string {
  const json = JSON.stringify({ createdAt: row.createdAt, sessionId: row.sessionId })
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeCursor(value: string): { createdAt: string; sessionId: string } {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    throw new SessionManagementError('INVALID_CURSOR', 'cursor is invalid')
  }

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      createdAt?: unknown
      sessionId?: unknown
    }

    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.sessionId !== 'string' ||
      parsed.sessionId.length < 1 ||
      parsed.sessionId.length > 128
    ) {
      throw new Error('invalid cursor payload')
    }

    return { createdAt: parsed.createdAt, sessionId: parsed.sessionId }
  } catch {
    throw new SessionManagementError('INVALID_CURSOR', 'cursor is invalid')
  }
}

function parseLimit(limit: number | undefined): number {
  if (limit === undefined) return 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SessionManagementError('INVALID_INPUT', 'limit must be between 1 and 100')
  }
  return Math.min(limit, 50)
}

function rolePlaceholders(roles: string[]): string {
  if (roles.length === 0) return 'NULL'
  return roles.map(() => '?').join(', ')
}

export async function listCurrentUserSessions(
  db: D1Database,
  input: {
    userId: string
    currentSessionId: string
    tokenVersion: number
    cursor?: string
    limit?: number
    now?: string
  },
): Promise<{ items: SessionListRow[]; nextCursor: string | null }> {
  assertSubjectId(input.userId)
  assertSessionId(input.currentSessionId)
  assertTokenVersion(input.tokenVersion)

  const now = input.now ?? new Date().toISOString()
  const pageSize = parseLimit(input.limit)
  const cursor = input.cursor ? decodeCursor(input.cursor) : null

  if (SESSION_READ_ROLES.length === 0) {
    throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session permission authority is unavailable')
  }

  const authorizationSql = `
    SELECT
      EXISTS (
        SELECT 1
        FROM users AS u
        WHERE CAST(u.id AS TEXT) = ?
          AND u.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')
          AND EXISTS (
            SELECT 1
            FROM role_assignments AS ra
            WHERE ra.subject_id = CAST(u.id AS TEXT)
              AND ra.status = 'ACTIVE'
              AND ra.scope_type = 'global'
              AND ra.valid_from <= ?
              AND (ra.valid_until IS NULL OR ? < ra.valid_until)
              AND ra.role_id IN (${rolePlaceholders(SESSION_READ_ROLES)})
          )
      ) AS permissionAllowed,
      EXISTS (
        SELECT 1
        FROM users_sessions AS current_session
        INNER JOIN auth_session_state AS current_state
          ON CAST(current_state.session_id AS TEXT) = CAST(current_session.id AS TEXT)
         AND current_state.user_id = CAST(current_session._parent_id AS TEXT)
        WHERE CAST(current_session.id AS TEXT) = ?
          AND CAST(current_session._parent_id AS TEXT) = ?
          AND current_state.token_version = ?
          AND current_state.revoked_at IS NULL
          AND current_session.expires_at > ?
      ) AS currentSessionValid
  `

  try {
    const authorization = await db.prepare(authorizationSql).bind(
      input.userId,
      now,
      now,
      ...SESSION_READ_ROLES,
      input.currentSessionId,
      input.userId,
      input.tokenVersion,
      now,
    ).first<{
      permissionAllowed: number
      currentSessionValid: number
    }>()

    if (!authorization || authorization.permissionAllowed !== 1) {
      throw new SessionManagementError('PERMISSION_DENIED', 'session permission denied')
    }
    if (authorization.currentSessionValid !== 1) {
      throw new SessionManagementError('UNAUTHENTICATED', 'current session is not valid')
    }
  } catch (error) {
    if (error instanceof SessionManagementError) throw error
    throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session authorization unavailable')
  }

  const cursorSql = cursor
    ? ' AND (s.created_at < ? OR (s.created_at = ? AND CAST(s.id AS TEXT) < ?))'
    : ''

  const sql = `
    SELECT
      CAST(s.id AS TEXT) AS sessionId,
      a.device_id AS deviceId,
      s.created_at AS createdAt,
      s.expires_at AS expiresAt,
      a.last_seen_at AS lastSeenAt
    FROM users_sessions AS s
    INNER JOIN auth_session_state AS a
      ON CAST(a.session_id AS TEXT) = CAST(s.id AS TEXT)
     AND a.user_id = CAST(s._parent_id AS TEXT)
    WHERE CAST(s._parent_id AS TEXT) = ?
      AND a.revoked_at IS NULL
      AND s.created_at IS NOT NULL
      AND s.expires_at > ?
      ${cursorSql}
    ORDER BY s.created_at DESC, CAST(s.id AS TEXT) DESC
    LIMIT ?
  `

  const bindings: unknown[] = [
    input.userId,
    now,
  ]

  if (cursor) {
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.sessionId)
  }
  bindings.push(pageSize + 1)

  try {
    const result = await db.prepare(sql).bind(...bindings).all<SessionListRow>()

    const rows = result.results ?? []
    const hasMore = rows.length > pageSize
    const items = rows.slice(0, pageSize).map((row) => ({
      sessionId: String(row.sessionId),
      deviceId: row.deviceId === null || row.deviceId === undefined ? null : String(row.deviceId),
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
      lastSeenAt: row.lastSeenAt === null || row.lastSeenAt === undefined ? null : String(row.lastSeenAt),
    }))

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null,
    }
  } catch (error) {
    if (error instanceof SessionManagementError) throw error
    throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session list unavailable')
  }
}

export async function revokeCurrentUserSession(
  db: D1Database,
  input: {
    userId: string
    currentSessionId: string
    tokenVersion: number
    targetSessionId: string
    now?: string
  },
): Promise<{ revoked: boolean }> {
  assertSubjectId(input.userId)
  assertSessionId(input.currentSessionId)
  assertSessionId(input.targetSessionId)
  assertTokenVersion(input.tokenVersion)

  const now = input.now ?? new Date().toISOString()

  if (SESSION_REVOKE_ROLES.length === 0) {
    throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session permission authority is unavailable')
  }

  const authorizationSql = `
    SELECT
      EXISTS (
        SELECT 1
        FROM users AS u
        WHERE CAST(u.id AS TEXT) = ?
          AND u.account_state IN ('PENDING_VERIFICATION', 'ACTIVE')
          AND EXISTS (
            SELECT 1
            FROM role_assignments AS ra
            WHERE ra.subject_id = CAST(u.id AS TEXT)
              AND ra.status = 'ACTIVE'
              AND ra.scope_type = 'global'
              AND ra.valid_from <= ?
              AND (ra.valid_until IS NULL OR ? < ra.valid_until)
              AND ra.role_id IN (${rolePlaceholders(SESSION_REVOKE_ROLES)})
          )
      ) AS permissionAllowed,
      EXISTS (
        SELECT 1
        FROM users_sessions AS current_session
        INNER JOIN auth_session_state AS current_state
          ON CAST(current_state.session_id AS TEXT) = CAST(current_session.id AS TEXT)
         AND current_state.user_id = CAST(current_session._parent_id AS TEXT)
        WHERE CAST(current_session.id AS TEXT) = ?
          AND CAST(current_session._parent_id AS TEXT) = ?
          AND current_state.token_version = ?
          AND current_state.revoked_at IS NULL
          AND current_session.expires_at > ?
      ) AS currentSessionValid,
      EXISTS (
        SELECT 1
        FROM auth_session_state AS target_extension
        WHERE CAST(target_extension.session_id AS TEXT) = ?
          AND target_extension.user_id = ?
          AND (
            target_extension.revoked_at IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM users_sessions AS target_native
              WHERE CAST(target_native.id AS TEXT) = ?
                AND CAST(target_native._parent_id AS TEXT) = ?
            )
          )
      ) AS targetOwned
  `

  try {
    const authorization = await db.prepare(authorizationSql).bind(
      input.userId,
      now,
      now,
      ...SESSION_REVOKE_ROLES,
      input.currentSessionId,
      input.userId,
      input.tokenVersion,
      now,
      input.targetSessionId,
      input.userId,
      input.targetSessionId,
      input.userId,
    ).first<{
      permissionAllowed: number
      currentSessionValid: number
      targetOwned: number
    }>()

    if (!authorization || authorization.permissionAllowed !== 1) {
      throw new SessionManagementError('PERMISSION_DENIED', 'session permission denied')
    }
    if (authorization.currentSessionValid !== 1) {
      throw new SessionManagementError('UNAUTHENTICATED', 'current session is not valid')
    }
    if (authorization.targetOwned !== 1) {
      throw new SessionManagementError('PERMISSION_DENIED', 'session permission denied')
    }

    const results = await db.batch([
      db.prepare(`
        UPDATE auth_session_state
           SET revoked_at = ?,
               last_seen_at = ?,
               token_version = token_version + 1
         WHERE CAST(session_id AS TEXT) = ?
           AND user_id = ?
           AND revoked_at IS NULL
      `).bind(now, now, input.targetSessionId, input.userId),
      db.prepare(`
        DELETE FROM users_sessions
         WHERE CAST(id AS TEXT) = ?
           AND CAST(_parent_id AS TEXT) = ?
      `).bind(input.targetSessionId, input.userId),
    ])

    if (results.length !== 2) {
      throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session revocation unavailable')
    }

    return {
      revoked:
        results[0]?.meta?.changes === 1 ||
        results[1]?.meta?.changes === 1,
    }
  } catch (error) {
    if (error instanceof SessionManagementError) throw error
    throw new SessionManagementError('SERVICE_UNAVAILABLE', 'session revocation unavailable')
  }
}
