import { getCloudflareContext } from '@opennextjs/cloudflare'
import { GET as payloadMediaGet } from '../../../(payload)/api/[...slug]/route'
import { callW03Content } from '../../../../content/w03-content-client'
import {
  mediaHostKind,
  mediaTypeAllowed,
  parseMediaByteRange,
  resolveMediaObjectKey,
} from '../../../../media/media-delivery'

type PayloadRouteContext = Parameters<typeof payloadMediaGet>[1]
type R2MediaEnvironment = { R2?: R2Bucket }

const privateError = (status: number, code: string): Response => Response.json({
  error: { code, message: 'Media unavailable', details: {} },
  requestId: 'req_' + crypto.randomUUID(),
}, { status, headers: { 'cache-control': 'private, no-store' } })

const safeHost = (request: Request): string => {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || request.headers.get('host') || new URL(request.url).host
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
  const response = await payloadMediaGet(new Request(target, request.clone()), context)
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
  let visibility: Response
  try {
    visibility = await callW03Content({
      request,
      pathname: '/internal/content/public-media-reference?url=' + encodeURIComponent(publicUrl),
      method: 'GET',
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

  if (data?.isPublic !== true) return privateOwnerDelivery(request, key, headOnly)

  let bucket: R2Bucket | undefined
  try {
    const cloudflare = await getCloudflareContext({ async: true })
    bucket = (cloudflare.env as unknown as R2MediaEnvironment).R2
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!bucket) return privateError(503, 'SERVICE_UNAVAILABLE')

  let object: R2ObjectBody | null
  try {
    object = await bucket.get(key)
  } catch {
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
  if (!object) return privateError(404, 'NOT_FOUND')

  const contentType = object.httpMetadata?.contentType ?? null
  if (!mediaTypeAllowed(hostKind, key, contentType)) return privateError(404, 'NOT_FOUND')

  const range = parseMediaByteRange(request.headers.get('range'), object.size)
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        'content-range': 'bytes */' + object.size,
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
      },
    })
  }
  if (range) {
    try {
      const ranged = await bucket.get(key, { range: { offset: range.offset, length: range.length } })
      if (!ranged) return privateError(404, 'NOT_FOUND')
      object = ranged
    } catch {
      return privateError(503, 'SERVICE_UNAVAILABLE')
    }
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('content-type', contentType)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('accept-ranges', 'bytes')
  // Keep cache lifetimes bounded until visibility-change cache invalidation is
  // implemented; do not let an unpublished post leave a long-lived public copy.
  headers.set('cache-control', 'public, max-age=0, must-revalidate')
  headers.set('cdn-cache-control', 'no-store')
  headers.set('content-length', String(range?.length ?? object.size))
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.uploaded) headers.set('last-modified', object.uploaded.toUTCString())
  if (range) {
    headers.set('content-range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + object.size)
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
