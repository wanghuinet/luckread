import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'

type SessionCursor = {
  createdAt: string
  sessionId: string
}

type SessionRow = {
  sessionId: string
  createdAt: string
  expiresAt: string
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const encodeCursor = (cursor: SessionCursor): string => {
  const encoded = btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return 's1.' + encoded
}

const decodeCursor = (value: string): SessionCursor | null => {
  if (!value.startsWith('s1.') || value.length > 256) return null
  const encoded = value.slice(3)
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null

  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (encoded.length % 4)) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<SessionCursor>
    if (
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.sessionId !== 'string' ||
      parsed.sessionId.length === 0 ||
      parsed.sessionId.length > 128
    ) return null

    return { createdAt: parsed.createdAt, sessionId: parsed.sessionId }
  } catch {
    return null
  }
}

/**
 * Lists only the authenticated user's current native Better Auth sessions.
 * Cursor/limit are validated before database access and SQL always uses a
 * server-derived user ID plus LIMIT (page size + one look-ahead row).
 */
export async function handleCurrentUserSessionList(
  env: BetterAuthEnv,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session list request' } }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session list request' } }, 400)
  }

  const input = body as { limit?: unknown; cursor?: unknown }
  const limit = input.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session list limit' } }, 400)
  }

  let cursor: SessionCursor | null = null
  if (input.cursor !== undefined && input.cursor !== null) {
    if (typeof input.cursor !== 'string') {
      return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
    }
    cursor = decodeCursor(input.cursor)
    if (!cursor) return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
  }

  let current: { user?: { id?: string }; session?: { id?: string } } | null
  try {
    const auth = createLuckReadAuth(env)
    current = await auth.api.getSession({ headers: request.headers, query: {} })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }

  const userId = typeof current?.user?.id === 'string' ? String(current.user.id) : ''
  const currentSessionId = typeof current?.session?.id === 'string' ? String(current.session.id) : ''
  if (!userId || !currentSessionId) {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  const now = new Date().toISOString()
  const sql = cursor
    ? 'SELECT id AS sessionId, created_at AS createdAt, expires_at AS expiresAt FROM "session" WHERE user_id = ? AND expires_at > ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?'
    : 'SELECT id AS sessionId, created_at AS createdAt, expires_at AS expiresAt FROM "session" WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id DESC LIMIT ?'

  try {
    const statement = env.D1_01.prepare(sql)
    const bound = cursor
      ? statement.bind(userId, now, cursor.createdAt, cursor.createdAt, cursor.sessionId, limit + 1)
      : statement.bind(userId, now, limit + 1)
    const result = await bound.all<SessionRow>()
    const rows = (result.results ?? []).filter((row) =>
      typeof row.sessionId === 'string' &&
      row.sessionId.length > 0 &&
      typeof row.createdAt === 'string' &&
      typeof row.expiresAt === 'string',
    )
    const page = rows.slice(0, limit)
    const hasMore = rows.length > limit
    const last = page[page.length - 1]

    return json({
      items: page.map((row) => ({
        sessionId: row.sessionId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        lastSeenAt: null,
      })),
      currentSessionId,
      nextCursor: hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, sessionId: last.sessionId })
        : null,
    })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }
}
