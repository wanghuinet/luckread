import { DELETE as payloadMediaDelete, GET as payloadMediaGet, PATCH as payloadMediaPatch } from '../../../(payload)/api/[...slug]/route'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]
type PayloadPatchRouteContext = Parameters<typeof payloadMediaPatch>[1]

type MediaDocument = {
  id?: string | number
  url?: string | null
  mimeType?: string | null
  filesize?: number | null
  width?: number | null
  height?: number | null
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
    ...document,
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
  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  const response = await payloadMediaGet(new Request(target, request.clone()), payloadContext)
  if (!response.ok) return response

  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }

  return new Response(JSON.stringify(withDeliveryStatus(body)), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    },
  })
}

type PayloadDeleteRouteContext = Parameters<typeof payloadMediaDelete>[1]

export async function DELETE(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadDeleteRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  return payloadMediaDelete(new Request(target, request.clone()), payloadContext)
}


export async function PATCH(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
): Promise<Response> {
  const { mediaId } = await context.params
  if (!mediaId?.trim()) return new Response(null, { status: 404 })

  const target = new URL('/api/media/' + encodeURIComponent(mediaId), request.url)
  const payloadContext: PayloadPatchRouteContext = {
    params: Promise.resolve({ slug: ['media', mediaId] }),
  }

  return payloadMediaPatch(new Request(target, request.clone()), payloadContext)
}
