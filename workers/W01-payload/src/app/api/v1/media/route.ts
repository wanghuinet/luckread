import { getPayload } from 'payload'

import config from '@payload-config'
import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { validateSession } from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type PayloadRouteContext = Parameters<typeof payloadMediaPost>[1]

const unauthorized = () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
  status: 401,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

async function authenticate(request: Request) {
  const payload = await getPayload({ config })
  let authResult: Awaited<ReturnType<typeof payload.auth>>
  try {
    authResult = await payload.auth({ headers: request.headers, canSetHeaders: false })
  } catch {
    return null
  }

  const user = authResult.user as unknown as ({ id?: string | number; _sid?: string } & Record<string, unknown>) | null
  if (!user?.id || typeof user._sid !== 'string' || user._sid.length === 0) return null

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (tokenVersion === null) return null
  const active = await validateSession({
    sessionId: user._sid,
    userId: String(user.id),
    tokenVersion,
  }).catch(() => false)
  return active ? { payload, user } : null
}

export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const authenticated = await authenticate(request)
  if (!authenticated) return unauthorized()

  const url = new URL(request.url)
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '24', 10)
  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24
  const page = Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1

  try {
    const result = await authenticated.payload.find({
      collection: 'media',
      where: { ownerUserId: { equals: String(authenticated.user.id) } },
      sort: '-createdAt',
      limit,
      page,
      depth: 0,
      overrideAccess: false,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

/**
 * Stable v1 upload entry for clients.
 *
 * The canonical media implementation remains Payload Media + R2. This route
 * only normalizes the public URL to Payload's existing /api/media upload
 * handler; it does not introduce a second media authority or storage path.
 */
export async function POST(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return new Response(
      JSON.stringify({ error: { code: 'PRECONDITION_REQUIRED', message: 'Idempotency-Key required' } }),
      { status: 428, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const target = new URL('/api/media', request.url)
  const context: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media'] }),
  }
  return payloadMediaPost(new Request(target, request.clone()), context)
}