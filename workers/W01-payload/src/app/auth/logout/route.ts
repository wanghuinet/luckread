import { REST_POST } from '@payloadcms/next/routes'
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
  if (!user?.id || !user._sid) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication failed')
  }

  const nativeLogout = REST_POST(config)
  let nativeResponse: Response
  try {
    nativeResponse = await nativeLogout(
      new Request(new URL('/api/users/logout', request.url), {
        method: 'POST',
        headers: request.headers,
      }),
      {
        params: Promise.resolve({
          slug: ['users', 'logout'],
        }),
      },
    )
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  if (!nativeResponse.ok) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication failed')
  }

  try {
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
