import { getPayload } from 'payload'

import config from '@payload-config'
import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

import {
  createPayloadBetterAuthBridgeRequest,
  createPayloadBetterAuthBridgeToken,
} from '@/auth/payload-better-auth-bridge'
import {
  resolveBetterAuthPrincipalThroughW02,
  W02AuthClientError,
} from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type PayloadRouteContext = Parameters<typeof payloadMediaPost>[1]

const unauthorized = () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
  status: 401,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

async function authenticate(request: Request) {
  const payload = await getPayload({ config })
  const principal = await resolveBetterAuthPrincipalThroughW02(request)
  if (!principal.active || principal.tokenVersion === undefined) {
    throw new W02AuthClientError(401, 'authentication required')
  }

  return {
    payload,
    user: { id: principal.userId },
  }
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

  let authenticated: Awaited<ReturnType<typeof authenticate>>
  try {
    authenticated = await authenticate(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

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

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  let principal: Awaited<ReturnType<typeof resolveBetterAuthPrincipalThroughW02>>
  try {
    principal = await resolveBetterAuthPrincipalThroughW02(request)
    if (!principal.active || principal.tokenVersion === undefined) {
      throw new W02AuthClientError(401, 'authentication required')
    }
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: error instanceof W02AuthClientError ? error.status : 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  try {
    const payload = await getPayload({ config })
    const token = await createPayloadBetterAuthBridgeToken(payload.secret, {
      sub: principal.userId,
      email: principal.email,
      method: 'POST',
      path: '/api/media',
    })
    const target = createPayloadBetterAuthBridgeRequest(
      request,
      '/api/media',
      token,
    )
    const context: PayloadRouteContext = {
      params: Promise.resolve({ slug: ['media'] }),
    }
    return payloadMediaPost(target, context)
  } catch {
    return new Response(JSON.stringify({ error: { code: 'MEDIA_UPLOAD_FAILED', message: 'Media upload failed' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

