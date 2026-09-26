import { getPayload } from 'payload'

import config from '@payload-config'

import { revokeSession, W02AuthClientError } from '../../../auth/w02-session-client.js'

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
  const payload = await getPayload({ config })

  const authResult = await payload.auth({
    headers: request.headers,
    canSetHeaders: false,
  })

  const user = authResult.user as { id?: string | number; _sid?: string } | null
  // authLogout is contractually idempotent: an already-revoked/expired current
  // session is a successful no-op rather than an authentication failure.
  if (!user?.id || !user._sid) {
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
      },
    })
  }

  try {
    // W02 owns both the extension revocation and the corresponding
    // Payload-native session mutation in one authoritative D1 batch.
    await revokeSession({ sessionId: user._sid })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
