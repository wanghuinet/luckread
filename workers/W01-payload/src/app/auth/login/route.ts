import { getPayload } from 'payload'

import config from '@payload-config'

import { buildPayloadAccessCookie, issuePayloadAccessToken } from '../../../auth/payload-access-token.js'
import {
  establishSession,
  resolveBetterAuthPrincipal,
  signInWithBetterAuth,
  W02AuthClientError,
} from '../../../auth/w02-session-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: {
        code,
        message,
        details: {},
      },
      requestId: crypto.randomUUID(),
    },
    status,
  )

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_LOGIN_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let body: { identity?: unknown; credential?: unknown; deviceId?: unknown }
  try {
    body = (await request.json()) as { identity?: unknown; credential?: unknown; deviceId?: unknown }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.identity !== 'string' ||
    body.identity.trim().length < 1 ||
    typeof body.credential !== 'string' ||
    body.credential.length < 1 ||
    typeof body.deviceId !== 'string' ||
    body.deviceId.length < 1 ||
    body.deviceId.length > 128
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid authentication request')
  }

  let nativeAuth
  try {
    nativeAuth = await signInWithBetterAuth({
      email: body.identity.trim().toLowerCase(),
      password: body.credential,
    })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(
        error.status,
        error.status === 401 ? 'UNAUTHENTICATED' : error.status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
        error.status === 401 ? 'Authentication denied' : 'Authentication service unavailable',
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  let principal
  try {
    principal = await resolveBetterAuthPrincipal(nativeAuth.token)
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(
        error.status,
        error.status === 401 ? 'UNAUTHENTICATED' : error.status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
        error.status === 401 ? 'Authentication denied' : 'Authentication service unavailable',
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  const payload = await getPayload({ config })

  try {
    let session
    try {
      session = await establishSession({
        sessionId: principal.sessionId,
        userId: principal.userId,
        deviceId: body.deviceId,
      })
    } catch (error) {
      if (!(error instanceof W02AuthClientError) || error.status !== 503) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
      session = await establishSession({
        sessionId: principal.sessionId,
        userId: principal.userId,
        deviceId: body.deviceId,
      })
    }

    const access = await issuePayloadAccessToken({
      payloadSecret: payload.secret,
      userId: principal.userId,
      email: principal.email.toLowerCase().trim(),
      sessionId: principal.sessionId,
      expiresAt: session.nativeExpiresAt,
      tokenVersion: session.tokenVersion,
    })

    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    if (nativeAuth.setCookie) headers.append('set-cookie', nativeAuth.setCookie)
    headers.append('set-cookie', buildPayloadAccessCookie(access.token, access.expiresIn, request))

    return new Response(
      JSON.stringify({
        accessToken: access.token,
        refreshToken: session.refreshToken,
        expiresIn: access.expiresIn,
        layer: session.layer,
      }),
      {
        status: 200,
        headers,
      },
    )
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(
        error.status,
        error.status === 401 ? 'UNAUTHENTICATED' : error.status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE',
        error.status === 401 ? 'Authentication denied' : 'Authentication service unavailable',
      )
    }

    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}
