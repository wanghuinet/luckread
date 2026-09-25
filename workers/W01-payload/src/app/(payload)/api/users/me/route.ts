import { REST_GET } from '@payloadcms/next/routes'
import { getPayload } from 'payload'

import config from '@payload-config'

import { isAuthoritativeSessionActive } from '../../../../../auth/authoritative-session.js'

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
  if (!user || !(await isAuthoritativeSessionActive(request, user))) {
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
