import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'

import { type D1DatabaseLike } from '../../../auth/authoritative-session.js'
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
    const revocation = await revokeSession({ sessionId: user._sid })
    if (!revocation.revoked) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Authentication failed')
    }
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  try {
    const context = await getCloudflareContext({ async: true })
    const env = context.env as unknown as { D1?: D1DatabaseLike }
    if (!env.D1) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
    }

    await env.D1
      .prepare(
        'DELETE FROM users_sessions WHERE CAST(id AS TEXT) = ? AND CAST(_parent_id AS TEXT) = ?',
      )
      .bind(String(user._sid), String(user.id))
      .run()
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
    },
  })
}
