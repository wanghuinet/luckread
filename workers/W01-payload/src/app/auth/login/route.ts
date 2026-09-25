import { getPayload } from 'payload'

import config from '@payload-config'

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
  } catch {
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

    return json({
      accessToken: loginResult.token,
      refreshToken: session.refreshToken,
      expiresIn: Math.max(0, loginResult.exp - Math.floor(Date.now() / 1000)),
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
