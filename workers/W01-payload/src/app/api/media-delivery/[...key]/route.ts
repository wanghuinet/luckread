import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getBetterAuthPrincipal, W02AuthClientError } from '../../../../auth/w02-session-client'
import { GET as payloadMediaGet } from '../../../(payload)/api/[...slug]/route'
import { callW03Content } from '../../../../content/w03-content-client'
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

type MediaVisibility = 'public' | 'private'

async function deliverFromR2(
  request: Request,
  key: string,
  hostKind: NonNullable<ReturnType<typeof mediaHostKind>>,
  headOnly: boolean,
  visibility: MediaVisibility,
): Promise<Response> {
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
  headers.set(
    'cache-control',
    visibility === 'public' ? 'public, max-age=0, must-revalidate' : 'private, no-store',
  )
  // Cloudflare's edge must not retain private bytes or cache publication state.
  headers.set('cdn-cache-control', 'no-store')
  headers.set('content-length', String(range?.length ?? metadata.size))
  if (object.httpEtag) headers.set('etag', object.httpEtag)
  if (object.uploaded) headers.set('last-modified', object.uploaded.toUTCString())
  if (range) {
    headers.set('content-range', 'bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + metadata.size)
  }

  if (
    request.headers.get('if-none-match') &&
    object.httpEtag &&
    request.headers.get('if-none-match') === object.httpEtag &&
    !range
  ) {
    const notModified = new Response(null, { status: 304, headers })
    return visibility === 'private' ? withNoStore(notModified) : notModified
  }

  const response = new Response(headOnly ? null : object.body, { status: range ? 206 : 200, headers })
  return visibility === 'private' ? withNoStore(response) : response
}

async function privateOwnerDelivery(
  request: Request,
  key: string,
  publicUrl: string,
  hostKind: NonNullable<ReturnType<typeof mediaHostKind>>,
  headOnly: boolean,
): Promise<Response> {
  let principal: Awaited<ReturnType<typeof getBetterAuthPrincipal>>
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return privateError(401, 'UNAUTHENTICATED')
    }
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }

  const filename = key.slice(key.lastIndexOf('/') + 1)
  try {
    const payload = await getPayload({ config })
    // Better Auth IDs and Payload profile IDs are different namespaces. Resolve
    // the canonical Payload user before checking the media owner relationship.
    const profileResult = await payload.find({
      collection: 'users',
      where: { identityId: { equals: principal.userId } },
      limit: 1,
      page: 1,
      depth: 0,
      overrideAccess: true,
    })
    const profile = profileResult.docs[0] as { id?: string | number } | undefined
    const payloadUserId = String(profile?.id ?? '').trim()
    if (!payloadUserId) return privateError(404, 'NOT_FOUND')

    const ownedMedia = await payload.find({
      collection: 'media',
      where: {
        ownerUserId: { equals: payloadUserId },
        filename: { equals: filename },
      } as any,
      limit: 50,
      page: 1,
      depth: 0,
      overrideAccess: true,
    })
    const ownsExactObject = ownedMedia.docs.some((value) => {
      const media = value as unknown as {
        ownerUserId?: string | number | null
        filename?: string | null
        url?: string | null
      }
      return String(media.ownerUserId ?? '') === payloadUserId &&
        String(media.filename ?? '') === filename &&
        typeof media.url === 'string' &&
        media.url === publicUrl
    })
    if (!ownsExactObject) return privateError(404, 'NOT_FOUND')
  } catch {
    // Fail closed: a metadata or identity service error never grants file access.
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }

  return deliverFromR2(request, key, hostKind, headOnly, 'private')
}

async function deliver(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
  headOnly: boolean,
): Promise<Response> {
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

  if (data?.isPublic !== true) {
    return privateOwnerDelivery(request, key, publicUrl, hostKind, headOnly)
  }

  return deliverFromR2(request, key, hostKind, headOnly, 'public')
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return deliver(request, context, false)
}

export async function HEAD(request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
  return deliver(request, context, true)
}
