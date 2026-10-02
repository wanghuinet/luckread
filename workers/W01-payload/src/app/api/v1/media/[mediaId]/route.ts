import { GET as payloadMediaGet } from '../../../(payload)/api/[...slug]/route'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]

/**
 * Stable v1 media metadata read entry.
 *
 * Payload Media remains the authoritative metadata/storage integration. This
 * adapter exposes the existing resource through the public v1 API namespace
 * without creating another media record or storage path.
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
  return payloadMediaGet(new Request(target, request.clone()), payloadContext)
}
