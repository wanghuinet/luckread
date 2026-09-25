import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { resolveGlobalLayer } from './authz/role-assignment.js'
import {
  establishSessionFromAuthoritativeD1,
  refreshSessionFromAuthoritativeD1,
} from './session/session-runtime.js'

interface Env { D1_01: D1Database; AUTH013_QUEUE: Queue }

type ResolveLayerRequest = {
  subjectId: string
  accountState: string
  now?: string
}

type EstablishSessionRequest = {
  sessionId: string
  userId: string
  deviceId: string
  now?: string
}

type RefreshSessionRequest = {
  refreshToken: string
  deviceId: string
  now?: string
}

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    const body = await request.json<T>()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/establish') {
      const body = await readJsonBody<EstablishSessionRequest>(request)
      if (
        !body ||
        typeof body.sessionId !== 'string' ||
        typeof body.userId !== 'string' ||
        typeof body.deviceId !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session establishment request' } }, 400)
      }

      try {
        const result = await establishSessionFromAuthoritativeD1(env.D1_01, body)
        return json({
          sessionId: result.sessionId,
          refreshToken: result.refreshToken,
          layer: result.layer,
          nativeExpiresAt: result.nativeExpiresAt,
        })
      } catch (error) {
        const code = error instanceof Error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'UNAVAILABLE'
        const status = code === 'UNAUTHENTICATED' ? 401 : code === 'INVALID_INPUT' ? 400 : 503
        return json({
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
            message: status === 401 ? 'authentication denied' : status === 400 ? 'invalid session request' : 'authentication service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/refresh') {
      const body = await readJsonBody<RefreshSessionRequest>(request)
      if (
        !body ||
        typeof body.refreshToken !== 'string' ||
        typeof body.deviceId !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session refresh request' } }, 400)
      }

      try {
        const result = await refreshSessionFromAuthoritativeD1(env.D1_01, body)
        return json({
          sessionId: result.sessionId,
          userId: result.userId,
          refreshToken: result.refreshToken,
          layer: result.layer,
          nativeExpiresAt: result.nativeExpiresAt,
          email: result.email,
        })
      } catch (error) {
        const code = error instanceof Error && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'UNAVAILABLE'
        const status = code === 'UNAUTHENTICATED' ? 401 : code === 'INVALID_INPUT' ? 400 : 503
        return json({
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
            message: status === 401 ? 'authentication denied' : status === 400 ? 'invalid session request' : 'authentication service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke') {
      const body = await readJsonBody<{ sessionId?: unknown }>(request)
      if (!body || typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid session revocation request' } }, 400)
      }

      try {
        const result = await revokeSessionExtension(env.D1_01, body.sessionId, new Date().toISOString())
        return json(result)
      } catch {
        return json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'authentication service unavailable',
          },
        }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/resolve-layer') {
      const body = await readJsonBody<ResolveLayerRequest>(request)
      if (!body || typeof body.subjectId !== 'string' || typeof body.accountState !== 'string') {
        return json({ decision: 'DENY' }, 400)
      }

      try {
        const result = await resolveGlobalLayer(env.D1_01, body.subjectId, body.accountState, body.now)
        return json(result)
      } catch {
        return json({ decision: 'DENY' }, 503)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await publishPendingAccountStateEvents(env)
  },
}
