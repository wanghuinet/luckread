import permissions from '../../../../contracts/authz/permissions.json'
import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { createD1SessionRevocationStore, type SessionRevocationStore } from './session-revoke-store.js'
import {
  enforceSessionRevokeRateLimits,
  sessionRateLimitErrorResponse,
} from './session-rate-limit.js'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const userRole = permissions['x-role-permissions'].roles.find((role) => role.role === 'user')
const SESSION_REVOKE_PERMISSION = 'user.session.revoke'
const userRoleCanRevokeSessions = userRole?.permissions.includes(SESSION_REVOKE_PERMISSION) === true

type SessionIdentity = {
  user?: { id?: unknown }
  session?: { id?: unknown }
} | null

export type SessionRevokeHandlerDependencies = {
  store?: SessionRevocationStore
  getSession?: (headers: Headers) => Promise<SessionIdentity>
}

/** Revoke a native Better Auth session under self-scope. */
export async function handleCurrentUserSessionRevoke(
  env: BetterAuthEnv,
  request: Request,
  dependencies: SessionRevokeHandlerDependencies = {},
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
    const store = dependencies.store ?? createD1SessionRevocationStore(env.D1_01)
    const result = await store.revoke({
      userId,
      sessionId,
      now: new Date().toISOString(),
      correlationId: request.headers.get('X-LuckRead-Request-Id'),
      causationId: request.headers.get('X-LuckRead-Correlation-Id'),
    })
    if (result.status === 'PERMISSION_DENIED') {
      return json({ error: { code: 'PERMISSION_DENIED', message: 'Session revocation is not permitted' } }, 403)
    }
    return json({ revoked: true })
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }
}
