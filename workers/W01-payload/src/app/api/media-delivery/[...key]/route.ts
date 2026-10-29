import { getCloudflareContext } from '@opennextjs/cloudflare'
import { GET as payloadMediaGet } from '../../../(payload)/api/[...slug]/route'
import { callW03Content, resolveOptionalCookieContentPrincipal } from '../../../../content/w03-content-client'
import {
  mediaHostKind,
  mediaTypeAllowed,
  parseMediaByteRange,
  resolveMediaObjectKey,
} from '../../../../media/media-delivery'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]
type R2MediaObject = {
  size: number
  httpMetadata?: { contentType?: string }
  httpEtag?: string
  uploaded?: Date
  writeHttpMetadata: (headers: Headers) => void
}
type R2MediaObjectBody = R2MediaObject & { body: ReadableStream<Uint8Array> }
type R2MediaBucket = {
  head: (key: string) => Promise<R2MediaObject | null>
  get: (key: string, options?: { range?: { offset: number; length: number } }) => Promise<R2MediaObjectBody | null>
}
type R2MediaEnvironment = { R2?: R2MediaBucket }

const privateError = (status: number, code: string): Response => Response.json({
  error: { code, message: 'Media unavailable', details: {} },
  requestId: 'req_' + crypto.randomUUID(),
}, { status, headers: { 'cache-control': 'private, no-store' } })

const safeHost = (request: Request): string => {
  const host = request.headers.get('host') || new URL(request.url).host
  try {
    return new URL('https://' + host).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const withNoStore = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private, no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function privateOwnerDelivery(request: Request, key: string, headOnly: boolean): Promise<Response> {
  const filename = key.slice(key.lastIndexOf('/') + 1)
  const target = new URL('/api/media/file/' + encodeURIComponent(filename), request.url)
  const context: PayloadRouteContext = {
    params: Promise.resolve({ slug: ['media', 'file', filename] }),
  }
  const response = await payloadMediaGet(new Request(target, { method: 'GET', headers: request.headers }), context)
  const safe = withNoStore(response)
  if (!headOnly) return safe
  return new Response(null, { status: safe.status, statusText: safe.statusText, headers: safe.headers })
}

async function deliver(request: Request, context: { params: Promise<{ key: string[] }> }, headOnly: boolean): Promise<Response> {
  const hostname = safeHost(request)
  const hostKind = mediaHostKind(hostname)
  if (!hostKind) return privateError(404, 'NOT_FOUND')

  const { key: segments } = await context.params
  const key = resolveMediaObjectKey(segments)
  if (!key) return privateError(404, 'NOT_FOUND')

  // W03 owns publication state and is the only authority that can authorize
  // anonymous delivery. A W03 error must not fall through to public R2 reads.
  const publicUrl = 'https://' + hostname + '/' + segments.map(encodeURIComponent).join('/')
  let principal: Awaited<ReturnType<typeof resolveOptionalCookieContentPrincipal>> = null
  try {
    const resolved = await resolveOptionalCookieContentPrincipal(request)
    // An expired/invalid session still behaves as anonymous. Other auth errors
    // do not grant member access, but need not block genuinely public media.
    if (!(resolved instanceof Response)) principal = resolved
    else if (resolved.status !== 401) principal = null
  } catch {
    principal = null
  }

  let visibility: Response
  try {
    visibility = await callW03Content({
      request,
      pathname: '/internal/content/public-media-reference?url=' + encodeURIComponent(publicUrl),
      method: 'GET',
      principal,
    })
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!visibility.ok) return privateError(503, 'SERVICE_UNAVAILABLE')

  let visibilityBody: unknown
  try {
    visibilityBody = await visibility.json()
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  const envelope = visibilityBody && typeof visibilityBody === 'object'
    ? visibilityBody as Record<string, unknown>
    : null
  const data = envelope?.data && typeof envelope.data === 'object'
    ? envelope.data as Record<string, unknown>
    : null
  if (typeof data?.isPublic !== 'boolean' ||
      typeof data?.isMemberContent !== 'boolean' ||
      typeof data?.allowed !== 'boolean') {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }

  const memberOnlyDelivery = data.isMemberContent === true && data.allowed === true
  if (data.isMemberContent === true && !memberOnlyDelivery) {
    // Member-only media is never sent to the owner-only Payload fallback for
    // a non-member reader. That path is reserved for standalone private assets.
    return privateError(404, 'NOT_FOUND')
  }
  if (data.isPublic !== true && !memberOnlyDelivery) {
    return privateOwnerDelivery(request, key, headOnly)
  }

  let bucket: R2MediaBucket | undefined
  try {
    const cloudflare = await getCloudflareContext({ async: true })
    bucket = (cloudflare.env as unknown as R2MediaEnvironment).R2
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!bucket) return privateError(503, 'SERVICE_UNAVAILABLE')

  let metadata: R2MediaObject | null
  try {
    metadata = await bucket.head(key)
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!metadata) return privateError(404, 'NOT_FOUND')

  const contentType = metadata.httpMetadata?.contentType ?? null
  if (!mediaTypeAllowed(hostKind, key, contentType)) return privateError(404, 'NOT_FOUND')

  const range = parseMediaByteRange(request.headers.get('range'), metadata.size)
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        'content-range': 'bytes */' + metadata.size,
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
      },
    })
  }

  let object: R2MediaObjectBody | null
  try {
    object = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined)
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!object) return privateError(404, 'NOT_FOUND')

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('content-type', contentType)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('accept-ranges', 'bytes')
  // Member-gated media is always private and non-cacheable. Public media keeps
  // the current revalidation policy and CDN no-store behavior until invalidation
  // is admitted across the content outbox and edge cache.
  headers.set('cache-control', memberOnlyDelivery ? 'private, no-store' : 'public, max-age=0, must-revalidate')
  headers.set('cdn-cache-control', 'no-store')
  headers.set('content-length', String(range?.length ?? metadata.size))
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.uploaded) headers.set('last-modified', object.uploaded.toUTCString())
  if (range) {
    headers.set('content-range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + metadata.size)
  }

  if (request.headers.get('if-none-match') && object.httpEtag && request.headers.get('if-none-match') === object.httpEtag && !range) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(headOnly ? null : object.body, { status: range ? 206 : 200, headers })
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return deliver(request, context, false)
}

export async function HEAD(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return deliver(request, context, true)
}
