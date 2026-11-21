import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'
import config from '@payload-config'

import { resolveCookieSocialPrincipal, callW05Social, W05SocialClientError } from '@/social/w05-social-client'
import { isCanonicalMediaDeliveryUrl, parseMediaByteRange, resolveMediaObjectKey } from '@/media/media-delivery'
import { apiErrorResponse } from '@/lib/api-response'

type MediaRecord = {
  id?: string | number
  url?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
}
type R2Object = {
  size: number
  httpMetadata?: { contentType?: string }
  httpEtag?: string
  writeHttpMetadata: (headers: Headers) => void
}
type R2ObjectBody = R2Object & { body: ReadableStream<Uint8Array> }
type R2Bucket = {
  head(key: string): Promise<R2Object | null>
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectBody | null>
}

const unavailable = (status: number, code: string) => apiErrorResponse(status, code, 'Attachment unavailable')
const safeFilename = (value: string) => value.replace(/[\r\n"]/g, '_').slice(0, 255) || 'attachment'

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string; mediaId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return unavailable(principal.status, principal.status === 401 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE')

    const { conversationId, mediaId } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(conversationId) ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(mediaId)) {
      return unavailable(404, 'NOT_FOUND')
    }

    // W05 is authoritative for the conversation membership and the exact
    // mediaId-to-message association. Never authorize from a client URL.
    const authorization = await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) +
        '/attachments/' + encodeURIComponent(mediaId) + '/authorize',
      method: 'GET',
      principal,
    })
    if (!authorization.ok) return unavailable(authorization.status === 404 ? 404 : authorization.status, 'NOT_FOUND')

    const payload = await getPayload({ config })
    const media = await payload.findByID({
      collection: 'media',
      id: mediaId,
      depth: 0,
      overrideAccess: true,
    }).catch((): null => null) as unknown as MediaRecord | null
    if (!media || String(media.id ?? '') !== mediaId ||
        typeof media.url !== 'string' || !isCanonicalMediaDeliveryUrl(media.url) ||
        typeof media.mimeType !== 'string' ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(media.mimeType.toLowerCase()) ||
        typeof media.filename !== 'string' || !media.filename.trim() ||
        typeof media.filesize !== 'number' || !Number.isSafeInteger(media.filesize) || media.filesize < 1 || media.filesize > 20 * 1024 * 1024) {
      return unavailable(404, 'NOT_FOUND')
    }

    const url = new URL(media.url)
    const segments = url.pathname.slice(1).split('/').map(segment => {
      try { return decodeURIComponent(segment) } catch { return '' }
    })
    const key = resolveMediaObjectKey(segments)
    if (!key) return unavailable(404, 'NOT_FOUND')

    const cloudflare = await getCloudflareContext({ async: true })
    const bucket = (cloudflare.env as unknown as { R2?: R2Bucket }).R2
    if (!bucket) return unavailable(503, 'SERVICE_UNAVAILABLE')

    const metadata = await bucket.head(key).catch((): null => null)
    if (!metadata || metadata.size !== media.filesize) return unavailable(404, 'NOT_FOUND')
    const expectedMime = media.mimeType.toLowerCase()
    const storedMime = metadata.httpMetadata?.contentType?.split(';', 1)[0]?.trim().toLowerCase()
    if (!storedMime || storedMime !== expectedMime) return unavailable(404, 'NOT_FOUND')

    const range = parseMediaByteRange(request.headers.get('range'), metadata.size)
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: {
        'content-range': 'bytes */' + metadata.size,
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      } })
    }
    const object = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined)
    if (!object) return unavailable(404, 'NOT_FOUND')

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('content-type', expectedMime)
    headers.set('content-length', String(range?.length ?? metadata.size))
    headers.set('content-disposition', 'inline; filename="' + safeFilename(media.filename) + '"')
    headers.set('cache-control', 'private, no-store')
    headers.set('cdn-cache-control', 'no-store')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('accept-ranges', 'bytes')
    if (object.httpEtag) headers.set('etag', object.httpEtag)
    if (range) headers.set('content-range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + metadata.size)
    return new Response(object.body, { status: range ? 206 : 200, headers })
  } catch (error) {
    if (error instanceof W05SocialClientError) return unavailable(error.status, error.code)
    return unavailable(503, 'SERVICE_UNAVAILABLE')
  }
}
