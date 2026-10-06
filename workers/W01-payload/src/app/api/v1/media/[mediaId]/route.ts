import { getPayload } from 'payload'

import config from '@payload-config'

import { resolveBetterAuthPrincipalThroughW02, W02AuthClientError } from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'

type MediaDocument = {
  id?: string | number
  url?: string | null
  mimeType?: string | null
  filesize?: number | null
  width?: number | null
  height?: number | null
  filename?: string | null
  alt?: string | null
  [key: string]: unknown
}

const withDeliveryStatus = (body: unknown): unknown => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body

  const envelope = body as Record<string, unknown>
  const document =
    envelope.doc && typeof envelope.doc === 'object' && !Array.isArray(envelope.doc)
      ? envelope.doc as MediaDocument
      : body as MediaDocument

  const deliveryReady = typeof document.url === 'string' && document.url.trim().length > 0
  const projected = {
    id: document.id ?? null,
    url: document.url ?? null,
    mimeType: document.mimeType ?? null,
    filesize: document.filesize ?? null,
    width: document.width ?? null,
    height: document.height ?? null,
    filename: document.filename ?? null,
    alt: document.alt ?? null,
    status: deliveryReady ? 'READY' : 'FAILED',
  }

  return envelope.doc && typeof envelope.doc === 'object' && !Array.isArray(envelope.doc)
    ? { ...envelope, doc: projected }
    : projected
}

/**
 * Stable v1 media metadata read entry.
 *
 * Payload Media remains the authoritative metadata/storage integration. This
 * adapter exposes the existing resource through the public v1 API namespace
 * without creating another media record or storage path.
 *
 * The status field is a delivery-state projection only: this 1.0 path has no
 * separate media-processing worker, so READY means the existing Payload/R2
 * asset has a usable URL. It does not claim transcoding has completed.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  try {
    const principal = await resolveBetterAuthPrincipalThroughW02(request)
    if (!principal.active || principal.tokenVersion === undefined) {
      throw new W02AuthClientError(401, 'authentication required')
    }
    const payload = await getPayload({ config })
    const document = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      overrideAccess: false,
      user: { id: principal.userId },
    })
    return new Response(JSON.stringify(withDeliveryStatus(document)), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    })
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    if (error instanceof W02AuthClientError) {
      return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(JSON.stringify({ error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return new Response(
      JSON.stringify({ error: { code: 'PRECONDITION_REQUIRED', message: 'Idempotency-Key required' } }),
      { status: 428, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
    )
  }

  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  try {
    const principal = await resolveBetterAuthPrincipalThroughW02(request)
    if (!principal.active || principal.tokenVersion === undefined) {
      throw new W02AuthClientError(401, 'authentication required')
    }
    const payload = await getPayload({ config })
    await payload.delete({
      collection: 'media',
      id: mediaId,
      overrideAccess: false,
      user: { id: principal.userId },
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    if (error instanceof W02AuthClientError) {
      return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(JSON.stringify({ error: { code: 'MEDIA_DELETE_FAILED', message: 'Media deletion failed' } }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}


export async function PATCH(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'Invalid media update request' } }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  try {
    const principal = await resolveBetterAuthPrincipalThroughW02(request)
    if (!principal.active || principal.tokenVersion === undefined) {
      throw new W02AuthClientError(401, 'authentication required')
    }
    const payload = await getPayload({ config })
    const result = await payload.update({
      collection: 'media',
      id: mediaId,
      data: body as Record<string, unknown>,
      overrideAccess: false,
      user: { id: principal.userId },
      depth: 0,
    })
    return Response.json(result, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    if (error instanceof W02AuthClientError) {
      return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Media service unavailable' } }), {
        status: error.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(JSON.stringify({ error: { code: 'MEDIA_UPDATE_FAILED', message: 'Media update failed' } }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
