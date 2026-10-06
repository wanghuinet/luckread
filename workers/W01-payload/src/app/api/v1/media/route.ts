import { getPayload } from 'payload'

import config from '@payload-config'

import {
  resolveBetterAuthPrincipalThroughW02,
  W02AuthClientError,
} from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

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

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Multipart form data required' } }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const rawPayload = form.get('_payload')
  const file = form.get('file')
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Media file required' } }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  let data: Record<string, unknown> = {}
  if (typeof rawPayload === 'string' && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload')
      data = parsed as Record<string, unknown>
    } catch {
      return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Invalid media metadata' } }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
  }

  try {
    const payload = await getPayload({ config })
    const result = await payload.create({
      collection: 'media',
      data,
      file,
      overrideAccess: false,
      user: { id: principal.userId },
      depth: 0,
    })

    return Response.json(result, {
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) return unauthorized()
    if (error instanceof W02AuthClientError) {
      return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    const status = typeof (error as { status?: unknown })?.status === 'number'
      ? Number((error as { status: number }).status)
      : 500
    if (status >= 400 && status < 500) {
      return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Media upload rejected' } }), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(JSON.stringify({ error: { code: 'MEDIA_UPLOAD_FAILED', message: 'Media upload failed' } }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

