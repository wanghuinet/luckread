import permissions from '../../../../contracts/authz/permissions.json'
import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import {
  createD1SessionListStore,
  type SessionListCursor,
  type SessionListStore,
} from './session-list-store.js'
import {
  enforceSessionListRateLimits,
  sessionRateLimitErrorResponse,
} from './session-rate-limit.js'

type SessionIdentity = {
  user?: { id?: unknown }
  session?: { id?: unknown }
} | null

export type SessionListHandlerDependencies = {
  store?: SessionListStore
  getSession?: (headers: Headers) => Promise<SessionIdentity>
}

const userRole = permissions['x-role-permissions'].roles.find((role) => role.role === 'user')
const SESSION_READ_PERMISSION = 'user.session.read'
const userRoleCanReadSessions = userRole?.permissions.includes(SESSION_READ_PERMISSION) === true

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const encodeCursor = (cursor: SessionListCursor): string => {
  const encoded = btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return 's1.' + encoded
}

const decodeCursor = (value: string): SessionListCursor | null => {
  if (!value.startsWith('s1.') || value.length > 256) return null
  const encoded = value.slice(3)
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null

  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (encoded.length % 4)) % 4)
    const parsed = JSON.parse(atob(padded)) as Partial<SessionListCursor>
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
  dependencies: SessionListHandlerDependencies = {},
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

  let cursor: SessionListCursor | null = null
  if (input.cursor !== undefined && input.cursor !== null) {
    if (typeof input.cursor !== 'string') {
      return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
    }
    cursor = decodeCursor(input.cursor)
    if (!cursor) return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
  }

  let current: SessionIdentity
  try {
    if (dependencies.getSession) {
      current = await dependencies.getSession(request.headers)
    } else {
      const auth = createLuckReadAuth(env)
      current = await auth.api.getSession({ headers: request.headers, query: {} }) as SessionIdentity
    }
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }

  const userId = typeof current?.user?.id === 'string' ? String(current.user.id) : ''
  const currentSessionId = typeof current?.session?.id === 'string' ? String(current.session.id) : ''
  if (!userId || !currentSessionId) {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  try {
    await enforceSessionListRateLimits(env, userId)
  } catch (error) {
    return sessionRateLimitErrorResponse(error)
  }

  const now = new Date().toISOString()
  // A user-layer name or client-supplied subject is never an authorization
  // fact. The selected store rechecks the effective W02-owned base-user role.
  if (!userRoleCanReadSessions) {
    return json({ error: { code: 'PERMISSION_DENIED', message: 'Session access is not permitted' } }, 403)
  }

  try {
    const store = dependencies.store ?? createD1SessionListStore(env.D1_01)
    const result = await store.list({
      userId,
      now,
      limit: limit + 1,
      cursor,
    })
    if (!result.permissionGranted) {
      return json({ error: { code: 'PERMISSION_DENIED', message: 'Session access is not permitted' } }, 403)
    }

    const page = result.rows.slice(0, limit)
    const hasMore = result.rows.length > limit
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
