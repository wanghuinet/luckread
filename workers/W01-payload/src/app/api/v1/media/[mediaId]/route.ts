import { TrafficLimitError, enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import { apiErrorResponse, appendRequestIdToJsonResponse, normalizeApiErrorResponse } from '@/lib/api-response'
import { DELETE as payloadMediaDelete, GET as payloadMediaGet, PATCH as payloadMediaPatch } from '../../../../(payload)/api/[...slug]/route'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]
type PayloadPatchRouteContext = Parameters<typeof payloadMediaPatch>[1]

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
  if (!mediaId?.trim()) return apiErrorResponse(404, 'NOT_FOUND', 'Media not found')

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Media service unavailable')
  }

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadPatchRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  const response = await payloadMediaPatch(new Request(target, request.clone()), payloadContext)
  return response.ok
    ? appendRequestIdToJsonResponse(response)
    : normalizeApiErrorResponse(response, 'Media service unavailable')
}
