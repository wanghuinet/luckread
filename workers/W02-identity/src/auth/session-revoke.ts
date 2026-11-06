import permissions from '../../../../contracts/authz/permissions.json'
import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { buildSessionRevocationOutboxInsert, buildSessionRevokedEvent } from './session-revocation-events.js'
import {
  enforceSessionRevokeRateLimits,
  sessionRateLimitErrorResponse,
} from './session-rate-limit.js'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const userRole = permissions['x-role-permissions'].roles.find((role) => role.role === 'user')
const SESSION_REVOKE_PERMISSION = 'user.session.revoke'
const userRoleCanRevokeSessions = userRole?.permissions.includes(SESSION_REVOKE_PERMISSION) === true

/** Revoke a native Better Auth session under self-scope. */
export async function handleCurrentUserSessionRevoke(
  env: BetterAuthEnv,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session revocation request' } }, 400)
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session revocation request' } }, 400)
  }

  const sessionId = (body as { sessionId?: unknown }).sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session revocation request' } }, 400)
  }

  let auth: ReturnType<typeof createLuckReadAuth>
  let current: { user?: { id?: string }; session?: { id?: string } } | null
  try {
    auth = createLuckReadAuth(env)
    current = await auth.api.getSession({ headers: request.headers, query: {} })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }

  const userId = typeof current?.user?.id === 'string' ? current.user.id : ''
  const currentSessionId = typeof current?.session?.id === 'string' ? current.session.id : ''
  if (!userId || !currentSessionId) {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  try {
    await enforceSessionRevokeRateLimits(env, userId, currentSessionId)
  } catch (error) {
    return sessionRateLimitErrorResponse(error)
  }

  // Protect the authenticated caller's current session at the identity authority
  // boundary before any lookup of the requested target session.
  if (sessionId === currentSessionId) {
    return json({
      error: { code: 'CURRENT_SESSION_PROTECTED', message: 'Current session cannot be revoked' },
    }, 409)
  }

  if (!userRoleCanRevokeSessions) {
    return json({ error: { code: 'PERMISSION_DENIED', message: 'Session revocation is not permitted' } }, 403)
  }

  try {
    const now = new Date().toISOString()
    const target = await env.D1_01
      .prepare(`
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
      .bind(userId, now, now, sessionId, userId)
      .first<{ permissionGranted: number; id: string | null; userId: string | null }>()

    if (!target) throw new Error('SESSION_REVOKE_AUTHORIZATION_READ_FAILED')
    if (Number(target.permissionGranted) !== 1) {
      return json({ error: { code: 'PERMISSION_DENIED', message: 'Session revocation is not permitted' } }, 403)
    }
    if (!target.id || String(target.userId) !== String(userId)) {
      return json({ revoked: true })
    }

    const occurredAt = new Date().toISOString()
    const event = await buildSessionRevokedEvent({
      sessionId: target.id,
      userId,
      occurredAt,
      correlationId: request.headers.get('X-LuckRead-Request-Id'),
      causationId: request.headers.get('X-LuckRead-Correlation-Id'),
    })
    // Better Auth's native D1-01 session row and the durable audit outbox are
    // committed atomically. If the outbox cannot be written, D1 rolls back the
    // DELETE and the caller receives 503 rather than an unaudited revocation.
    const committed = await env.D1_01.batch([
      env.D1_01.prepare(`
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
      `).bind(target.id, userId, userId, now, now),
      buildSessionRevocationOutboxInsert(env.D1_01, event),
    ])
    const deleted = committed[0]
    const journaled = committed[1]
    if (deleted?.success !== true || journaled?.success !== true) {
      throw new Error('SESSION_REVOKE_AUDIT_BATCH_FAILED')
    }
    if (Number(deleted.meta?.changes ?? 0) === 0) {
      // Another concurrent request already removed this caller-owned session.
      // Its atomic batch owns the one logical event; this replay is a no-op.
      return json({ revoked: true })
    }
    if (Number(deleted.meta?.changes) !== 1 || Number(journaled.meta?.changes) !== 1) {
      throw new Error('SESSION_REVOKE_AUDIT_BATCH_INCOMPLETE')
    }

    return json({ revoked: true })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }
}
