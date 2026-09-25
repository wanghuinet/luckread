import { getPayload } from 'payload'

import config from '@payload-config'

import { issuePayloadAccessToken } from '../../../auth/payload-access-token.js'
import { establishSession, W02AuthClientError } from '../../../auth/w02-session-client.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
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

const classifyPayloadLoginFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()

  if (/invalid (?:email|password|credentials)|incorrect password|invalid credentials|password.*(?:invalid|incorrect)/.test(normalized)) {
    return 'CREDENTIAL_REJECTED'
  }
  if (/user.*(?:not found|does not exist)|(?:email|identity).*(?:not found|does not exist)/.test(normalized)) {
    return 'IDENTITY_NOT_FOUND'
  }
  if (/(?:sqlite|d1|database|sql|constraint|column|table|migration)/.test(normalized)) {
    return 'D1_RUNTIME_OR_SCHEMA'
  }
  if (/(?:argon|bcrypt|scrypt|pbkdf|password.*hash|hash.*password|crypto)/.test(normalized)) {
    return 'PASSWORD_HASH_RUNTIME'
  }
  if (/(?:adapter|collection|payload.*auth|auth.*configuration|config)/.test(normalized)) {
    return 'PAYLOAD_AUTH_RUNTIME'
  }
  return 'UNKNOWN'
}

const sanitizePayloadLoginMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?:password|credential|token|secret)\s*[:=]\s*[^,;\s]+/gi, '$1=[REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, '[REDACTED_LONG_VALUE]')
    .slice(0, 240)
}

export async function POST(request: Request): Promise<Response> {
  let body: { identity?: unknown; credential?: unknown; deviceId?: unknown }

  try {
    body = (await request.json()) as { identity?: unknown; credential?: unknown; deviceId?: unknown }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.identity !== 'string' ||
    body.identity.length < 1 ||
    typeof body.credential !== 'string' ||
    body.credential.length < 1 ||
    typeof body.deviceId !== 'string' ||
    body.deviceId.length < 1 ||
    body.deviceId.length > 128
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid authentication request')
  }

  const payload = await getPayload({ config })

  let loginResult: Awaited<ReturnType<typeof payload.login>>
  try {
    loginResult = await payload.login({
      collection: 'users',
      data: {
        email: body.identity,
        password: body.credential,
      },
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'auth.login.payload_failure',
        diagnosticCode: 'AUTH002_PAYLOAD_LOGIN_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
        failureClass: classifyPayloadLoginFailure(error),
        message: sanitizePayloadLoginMessage(error),
      }),
    )
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication failed')
  }

  if (!loginResult.token || !loginResult.user?.id || !loginResult.exp) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication runtime is unavailable')
  }

  const authResult = await payload.auth({
    headers: new Headers({
      Authorization: `Bearer ${loginResult.token}`,
    }),
    canSetHeaders: false,
  })

  const nativeUser = authResult.user as (typeof loginResult.user & { _sid?: string }) | null
  const nativeSid = nativeUser?._sid

  if (!nativeSid || !nativeUser?.id) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Native session binding is unavailable')
  }

  try {
    const session = await establishSession({
      sessionId: nativeSid,
      userId: String(nativeUser.id),
      deviceId: body.deviceId,
    })

    const access = await issuePayloadAccessToken({
      payloadSecret: payload.secret,
      userId: String(nativeUser.id),
      email: String(nativeUser.email ?? body.identity),
      sessionId: nativeSid,
      expiresAt: session.nativeExpiresAt,
      tokenVersion: session.tokenVersion,
    })

    return json({
      accessToken: access.token,
      refreshToken: session.refreshToken,
      expiresIn: access.expiresIn,
      layer: session.layer,
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
}
