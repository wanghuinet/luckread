import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import {
  enforceSessionRevokeRateLimits,
  sessionRateLimitErrorResponse,
} from './session-rate-limit.js'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

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
    await enforceSessionRevokeRateLimits(env, userId, sessionId)
  } catch (error) {
    return sessionRateLimitErrorResponse(error)
  }

  try {
    const target = await env.D1_01
      .prepare('SELECT id, token, user_id AS userId FROM "session" WHERE id = ? LIMIT 1')
      .bind(sessionId)
      .first<{ id: string; token: string; userId: string }>()

    if (!target || String(target.userId) !== String(userId)) {
      return json({ revoked: true })
    }

    await auth.api.revokeSession({
      headers: request.headers,
      body: { token: target.token },
    })

    return json({ revoked: true })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }
}
