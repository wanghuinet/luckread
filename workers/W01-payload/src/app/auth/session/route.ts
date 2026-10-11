import { proxyBetterAuth } from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

type PublicUser = {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const publicUser = (value: unknown): PublicUser | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.email !== 'string') return null
  if (typeof value.emailVerified !== 'boolean') return null
  return {
    id: value.id,
    email: value.email,
    name: typeof value.name === 'string' ? value.name : null,
    emailVerified: value.emailVerified,
    image: typeof value.image === 'string' ? value.image : null,
  }
}

const responseHeaders = (upstream?: Response): Headers => {
  const headers = new Headers(upstream?.headers)
  headers.delete('set-auth-token')
  headers.delete('X-LuckRead-Session-Token')
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.delete('transfer-encoding')
  headers.set('cache-control', 'no-store')
  return headers
}

const errorResponse = (status: number, code: string, message: string, upstream?: Response) => {
  const headers = responseHeaders(upstream)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({
    error: { code, message, details: {} },
    requestId: crypto.randomUUID(),
  }), { status, headers })
}

const successResponse = (upstream: Response, payload: Record<string, unknown>): Response => {
  const session = payload.session
  const user = publicUser(payload.user)
  if (
    !isRecord(session) ||
    typeof session.id !== 'string' ||
    typeof session.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(session.expiresAt)) ||
    !user
  ) {
    return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid session response', upstream)
  }

  const headers = responseHeaders(upstream)
  headers.set('content-type', 'application/json; charset=utf-8')
  const refreshedToken = upstream.headers.get('set-auth-token')
  if (refreshedToken) headers.set('X-LuckRead-Session-Token', refreshedToken)

  return new Response(JSON.stringify({
    data: {
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
      user,
    },
    requestId: crypto.randomUUID(),
  }), { status: 200, headers })
}

export async function GET(request: Request): Promise<Response> {
  try {
    // Reuse the existing W01 auth refresh limiter; no new Cloudflare binding
    // is introduced for this authenticated session-read operation.
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REFRESH_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let upstream: Response
  try {
    upstream = await proxyBetterAuth(request, '/get-session', { method: 'GET' })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required', upstream)
  }
  if (upstream.status >= 500) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable', upstream)
  }
  if (!upstream.ok) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable', upstream)
  }

  let payload: unknown = null
  try { payload = await upstream.clone().json() } catch {
    return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid session response', upstream)
  }

  // Better Auth returns JSON null with HTTP 200 when no session is present.
  if (payload === null) {
    return errorResponse(401, 'UNAUTHENTICATED', 'A valid session is required', upstream)
  }
  if (!isRecord(payload)) {
    return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid session response', upstream)
  }

  return successResponse(upstream, payload)
}
