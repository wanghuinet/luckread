import { getPayload } from 'payload'

import config from '@payload-config'
import { POST as payloadMediaPost } from '../../../(payload)/api/[...slug]/route'

import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse, normalizeApiErrorResponse } from '@/lib/api-response'

type PayloadRouteContext = Parameters<typeof payloadMediaPost>[1]

const unauthorized = () => apiErrorResponse(401, 'UNAUTHENTICATED', 'Authentication required')

async function authenticate(request: Request) {
  const principal = await getBetterAuthPrincipal(request)
  const payload = await getPayload({ config })
  return { payload, userId: principal.userId }
}

const authenticateErrorResponse = (error: unknown): Response => {
  if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
  return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media authentication service unavailable')
}
export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  let authenticated: Awaited<ReturnType<typeof authenticate>>
  try {
    authenticated = await authenticate(request)
  } catch (error) {
    return authenticateErrorResponse(error)
  }

  const url = new URL(request.url)
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '24', 10)
  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 24
  const page = Number.isFinite(requestedPage) ? Math.max(requestedPage, 1) : 1

  try {
    const result = await authenticated.payload.find({
      collection: 'media',
      where: { ownerUserId: { equals: authenticated.userId } },
      sort: '-createdAt',
      limit,
      page,
      depth: 0,
      overrideAccess: true,
    })

    return await appendRequestIdToJsonResponse(new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    }))
  } catch {
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
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
  if (!idempotencyKey) return apiErrorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return apiErrorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  const target = new URL('/api/media', request.url)
  const context: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media'] }),
  }
  const response = await payloadMediaPost(new Request(target, request.clone()), context)
  return response.ok
    ? appendRequestIdToJsonResponse(response)
    : normalizeApiErrorResponse(response, 'Media service unavailable')
}