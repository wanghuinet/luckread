import { getPayload } from 'payload'

import config from '@payload-config'
import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

import { getBetterAuthSession } from '@/auth/better-auth'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

const unauthorized = () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
  status: 401,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

async function authenticate(request: Request) {
  const payload = await getPayload({ config })
  const session = await getBetterAuthSession(request).catch(() => null)
  if (!session?.user?.id) return null

  const user = await payload.findByID({
    collection: 'users',
    id: String(session.user.id),
    depth: 0,
    overrideAccess: true,
  }).catch(() => null)

  return user ? { payload, user } : null
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
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  } catch {
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

export async function POST(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return new Response(
      JSON.stringify({ error: { code: 'PRECONDITION_REQUIRED', message: 'Idempotency-Key required' } }),
      { status: 428, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const target = new URL('/api/media', request.url)
  type PayloadRouteContext = Parameters<typeof payloadMediaPost>[1]
  const context: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media'] }),
  }
  return payloadMediaPost(new Request(target, request.clone()), context)
}
