import { REST_GET } from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import config from '@payload-config'

import { readVerifiedPayloadTokenVersion } from '../../../../../auth/payload-access-token.js'
import { validateSession } from '../../../../../auth/w02-session-client.js'

const unauthorized = () =>
  new Response(
    JSON.stringify({
      errors: [{ message: 'Authentication failed' }],
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

export async function GET(request: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const authResult = await payload.auth({
    headers: request.headers,
    canSetHeaders: false,
  })

  const user = authResult.user as { id?: string | number; _sid?: string } | null
  if (!user?.id || !user._sid) {
    return unauthorized()
  }

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (tokenVersion === null) return unauthorized()

  try {
    const active = await validateSession({
      sessionId: String(user._sid),
      userId: String(user.id),
      tokenVersion,
    })
    if (!active) return unauthorized()
  } catch {
    return unauthorized()
  }

  try {
    const handler = REST_GET(config)
    return await handler(request, {
      params: Promise.resolve({ slug: ['users', 'me'] }),
    })
  } catch {
    return unauthorized()
  }
}
