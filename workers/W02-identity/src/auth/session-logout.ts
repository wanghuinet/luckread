import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import {
  createD1SessionLogoutStore,
  type SessionLogoutStore,
} from './session-logout-store.js'
import {
  enforceSessionLogoutRateLimits,
  sessionRateLimitErrorResponse,
} from './session-rate-limit.js'

type SessionIdentity = {
  user?: { id?: unknown }
  session?: { id?: unknown }
} | null

export type SessionLogoutHandlerDependencies = {
  store?: SessionLogoutStore
  auth?: ReturnType<typeof createLuckReadAuth>
  getSession?: (headers: Headers) => Promise<SessionIdentity>
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

async function clearBetterAuthSessionCookies(
  auth: ReturnType<typeof createLuckReadAuth>,
  request: Request,
): Promise<Response> {
  // The authoritative session row is already revoked and audited. Remove only
  // that credential from the cleanup request. Keeping session-data cookies
  // lets Better Auth expire any chunked session cache through its own utility.
  const headers = new Headers(request.headers)
  const authContext = await auth.$context
  const sessionTokenCookieName = authContext.authCookies.sessionToken.name
  const cookieHeader = headers.get('cookie')
  if (cookieHeader) {
    const retainedCookies = cookieHeader.split(';').filter((segment) => {
      const separator = segment.indexOf('=')
      const name = (separator < 0 ? segment : segment.slice(0, separator)).trim()
      return name !== sessionTokenCookieName
    }).join('; ')
    if (retainedCookies) headers.set('cookie', retainedCookies)
    else headers.delete('cookie')
  }
  for (const name of [
    'authorization',
    'x-luckread-session-token',
    'set-auth-token',
    'content-length',
    'content-type',
  ]) {
    headers.delete(name)
  }

  // With the already-revoked session credential absent, Better Auth's official
  // handler skips findSession/deleteSession but still expires its configured
  // session, session-data and chunk cookies.
  const cleanupRequest = new Request(new URL('/api/auth/sign-out', request.url), {
    method: 'POST',
    headers,
  })
  const response = await auth.handler(cleanupRequest)
  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('cache-control', 'no-store')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

/**
 * Log out only the authenticated caller's current Better Auth session.
 * The session identity is derived from W02's own auth lookup; no target ID or
 * role/account-state gate is accepted for this self-termination operation.
 */
export async function handleCurrentUserSessionLogout(
  env: BetterAuthEnv,
  request: Request,
  dependencies: SessionLogoutHandlerDependencies = {},
): Promise<Response> {
  let auth: ReturnType<typeof createLuckReadAuth>
  let current: { user?: { id?: unknown }; session?: { id?: unknown } } | null
  try {
    auth = dependencies.auth ?? createLuckReadAuth(env)
    const authContext = await auth.$context

    // Mirror Better Auth's default CSRF rule: unsafe requests carrying cookies
    // must present an explicit trusted Origin/Referer before any D1 mutation.
    // Bearer-only native requests do not use cookie CSRF validation.
    if (request.headers.has('cookie')) {
      let origin = request.headers.get('origin') || request.headers.get('referer')
      // Preserve Better Auth's null-origin exception only when Fetch Metadata
      // proves a same-origin browser request; infer the internal request origin
      // used by the W01 -> W02 service-binding hop.
      if (origin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin') {
        origin = new URL(request.url).origin
      }
      if (!origin || origin === 'null' || !authContext.isTrustedOrigin(origin, { allowRelativePaths: false })) {
        return json({ error: { code: 'FORBIDDEN', message: 'Invalid request origin' } }, 403)
      }
    }

    current = dependencies.getSession
      ? await dependencies.getSession(request.headers)
      : await auth.api.getSession({
          headers: request.headers,
          query: { disableCookieCache: true, disableRefresh: true },
        }) as SessionIdentity
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }

  if (current) {
    const userId = typeof current.user?.id === 'string' ? current.user.id : ''
    const sessionId = typeof current.session?.id === 'string' ? current.session.id : ''
    if (!userId || !sessionId) {
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session identity unavailable' } }, 503)
    }

    try {
      await enforceSessionLogoutRateLimits(env, userId, sessionId)
    } catch (error) {
      return sessionRateLimitErrorResponse(error)
    }

    try {
      const store = dependencies.store ?? createD1SessionLogoutStore(env.D1_01)
      await store.logout({
        userId,
        sessionId,
        now: new Date().toISOString(),
        correlationId: request.headers.get('X-LuckRead-Request-Id'),
        causationId: request.headers.get('X-LuckRead-Correlation-Id'),
      })
    } catch {
      // Fail closed: do not clear credentials or report logout when the
      // authoritative DELETE + durable audit intent could not be committed.
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
    }
  }

  try {
    // Also clears stale cookies for an already-revoked/expired credential.
    return await clearBetterAuthSessionCookies(auth, request)
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }
}
