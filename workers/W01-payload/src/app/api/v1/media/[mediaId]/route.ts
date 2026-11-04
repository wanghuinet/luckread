import { getPayload } from 'payload'
import config from '@payload-config'

import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'
import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse, normalizeApiErrorResponse } from '@/lib/api-response'
import { resolvePayloadOwnerUserId } from '@/media/media-owner'
import { DELETE as payloadMediaDelete, GET as payloadMediaGet } from '../../../../(payload)/api/[...slug]/route'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]

type MediaDocument = {
  id?: string | number
  url?: string | null
  mimeType?: string | null
  filesize?: number | null
  width?: number | null
  height?: number | null
  filename?: string | null
  alt?: string | null
  ownerUserId?: string | number | null
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
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  const { mediaId } = await context.params
  if (!mediaId?.trim()) return apiErrorResponse(404, 'NOT_FOUND', 'Media not found')

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  const response = await payloadMediaGet(new Request(target, request.clone()), payloadContext)
  if (!response.ok) return normalizeApiErrorResponse(response, 'Media service unavailable')

  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }

  return appendRequestIdToJsonResponse(new Response(JSON.stringify(withDeliveryStatus(body)), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    },
  }))
}

type PayloadDeleteRouteContext = Parameters<typeof payloadMediaDelete>[1]

export async function DELETE(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey) return apiErrorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return apiErrorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')

  const { mediaId } = await context.params
  if (!mediaId?.trim()) return apiErrorResponse(404, 'NOT_FOUND', 'Media not found')

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadDeleteRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  const response = await payloadMediaDelete(new Request(target, request.clone()), payloadContext)
  return response.ok
    ? appendRequestIdToJsonResponse(response)
    : normalizeApiErrorResponse(response, 'Media service unavailable')
}


export async function PATCH(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const { mediaId } = await context.params
  if (!mediaId?.trim() || mediaId.length > 256) {
    return apiErrorResponse(404, 'NOT_FOUND', 'Media not found')
  }

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  let payloadBody: unknown
  try {
    payloadBody = await request.clone().json()
  } catch {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Valid JSON media metadata is required')
  }
  if (
    !payloadBody ||
    typeof payloadBody !== 'object' ||
    Array.isArray(payloadBody) ||
    Object.keys(payloadBody).some((key) => key !== 'alt') ||
    typeof (payloadBody as { alt?: unknown }).alt !== 'string'
  ) {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Only the media alt text field can be updated')
  }
  const alt = (payloadBody as { alt: string }).alt.normalize('NFKC').trim()
  if (!alt || alt.length > 1000) {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Media alt text must contain between 1 and 1000 characters')
  }

  try {
    // W02 is the identity authority. Resolve its principal to the W01/Payload
    // profile and enforce exact ownership before performing the narrow update.
    const principal = await getBetterAuthPrincipal(request)
    const payload = await getPayload({ config })
    const payloadUserId = await resolvePayloadOwnerUserId(payload, principal.userId)
    if (!payloadUserId) {
      return apiErrorResponse(401, 'UNAUTHENTICATED', 'Account profile is not available')
    }

    const ownedMedia = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      overrideAccess: true,
    }).catch(() => null) as MediaDocument | null
    if (!ownedMedia || String(ownedMedia.ownerUserId ?? '') !== payloadUserId) {
      return apiErrorResponse(404, 'NOT_FOUND', 'Media not found')
    }

    // ownerUserId and all upload/storage fields are immutable here; only alt
    // is accepted from the client. The preceding W02-to-Payload owner check
    // is the authorization gate for this explicit overrideAccess update.
    const updated = await payload.update({
      collection: 'media',
      id: ownedMedia.id ?? mediaId,
      data: { alt },
      depth: 0,
      overrideAccess: true,
    }) as MediaDocument
    const projected = {
      id: updated.id ?? mediaId,
      url: updated.url ?? null,
      filename: updated.filename ?? null,
      mimeType: updated.mimeType ?? null,
      filesize: updated.filesize ?? null,
      width: updated.width ?? null,
      height: updated.height ?? null,
      alt: typeof updated.alt === 'string' ? updated.alt : alt,
    }
    return await appendRequestIdToJsonResponse(new Response(JSON.stringify({ doc: projected }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    }))
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return apiErrorResponse(
        error.status,
        error.code ?? (error.status === 401 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE'),
        error.status === 401 ? 'Authentication required' : 'Media service unavailable',
      )
    }
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }
}
