import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'
import config from '@payload-config'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '@/auth/traffic-limit'
import {
  callW03Content,
  resolveOptionalCookieContentPrincipal,
  W03ContentClientError,
} from '@/content/w03-content-client'
import { hasAuthenticatedSessionCredential } from '@/lib/content-list-cache-guard'
import { resolveMediaObjectKey } from '@/media/media-delivery'

type ContentBodyR2Object = {
  size: number
  httpMetadata?: { contentType?: string }
  body: ReadableStream<Uint8Array>
}
type ContentBodyR2Bucket = {
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>
  get(key: string): Promise<ContentBodyR2Object | null>
}

const BODY_PREVIEW_MAX_BYTES = 40_000
const BODY_DETAIL_MAX_BYTES = 1_048_576

async function isBodyAssetOwnedByContentOwner(
  bodyRef: string,
  filename: string,
  ownerIdentityId: string,
): Promise<boolean> {
  try {
    const payload = await getPayload({ config })
    const profileResult = await payload.find({
      collection: 'users',
      where: { identityId: { equals: ownerIdentityId } },
      limit: 1,
      page: 1,
      depth: 0,
      overrideAccess: true,
    })
    const profileId = profileResult.docs[0]?.id
    if (profileId === undefined || profileId === null) return false
    const ownerId = String(profileId)

    const mediaResult = await payload.find({
      collection: 'media',
      where: {
        and: [
          { filename: { equals: filename } },
          { ownerUserId: { equals: ownerId } },
        ],
      },
      limit: 2,
      page: 1,
      depth: 0,
      overrideAccess: true,
    })
    // Verify the exact generated URL, not just the filename. A content row must
    // never point at another user's R2 object, even if the caller is a member.
    return mediaResult.docs.some((doc) => {
      // Payload's generated Media type has not yet modeled the existing custom
      // ownerUserId field. Keep the runtime check explicit without widening the
      // collection's generated type or changing Payload Core.
      const media = doc as unknown as {
        ownerUserId?: unknown
        filename?: unknown
        url?: unknown
      }
      return String(media.ownerUserId ?? '') === ownerId &&
        String(media.filename ?? '') === filename &&
        typeof media.url === 'string' &&
        media.url === bodyRef
    })
  } catch {
    return false
  }
}

const privateError = (status: number, code: string) => Response.json({
  error: { code, message: 'Content body unavailable', details: {} },
  requestId: 'req_' + crypto.randomUUID(),
}, {
  status,
  headers: {
    'cache-control': 'private, no-store',
    'cdn-cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
})

function resolveBodyObjectKey(value: unknown): { key: string; contentType: 'application/json; charset=utf-8' | 'text/plain; charset=utf-8' } | null {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value) return null
  let url: URL
  let segments: string[]
  try {
    url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'img.luckread.com' ||
        url.port || url.username || url.password || url.hash || url.search) return null
    segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  } catch {
    return null
  }
  const key = resolveMediaObjectKey(segments)
  if (!key || segments.length < 2) return null
  const filename = segments[segments.length - 1]!
  // Only Payload objects created by the existing editor's content-body upload
  // path may be served here; arbitrary media/object references are not bodies.
  if (/^luckread-article-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(filename)) {
    return { key, contentType: 'application/json; charset=utf-8' }
  }
  if (/^luckread-content-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt$/i.test(filename)) {
    return { key, contentType: 'text/plain; charset=utf-8' }
  }
  return null
}

/**
 * Body bytes are never fetched straight from a client-supplied bodyRef. Resolve
 * the content through W03 first so the access-mode/subscription decision is
 * re-evaluated for every read; only then read the bounded matching Payload/R2
 * body object through W01's existing bucket binding.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    if (!contentId || contentId.length > 256 || /[\u0000-\u001f\u007f]/.test(contentId)) {
      return privateError(404, 'NOT_FOUND')
    }

    if (!hasAuthenticatedSessionCredential(request)) await enforcePublicReadRateLimit(request)
    const principal = await resolveOptionalCookieContentPrincipal(request)
    if (principal instanceof Response) return privateError(principal.status, 'UNAUTHENTICATED')

    const contentResponse = await callW03Content({
      request,
      pathname: '/internal/content/contents/' + encodeURIComponent(contentId) + '?bodyContext=1',
      method: 'GET',
      principal,
    })
    if (!contentResponse.ok) {
      return contentResponse.status === 404
        ? privateError(404, 'NOT_FOUND')
        : privateError(503, 'SERVICE_UNAVAILABLE')
    }

    const value: unknown = await contentResponse.json().catch((): null => null)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return privateError(503, 'SERVICE_UNAVAILABLE')
    }
    const content = value as Record<string, unknown>
    if (content.contentId !== contentId ||
        typeof content.ownerUserId !== 'string' ||
        !content.ownerUserId ||
        (content.accessMode !== 'PUBLIC' && content.accessMode !== 'MEMBERS_ONLY') ||
        content.accessGranted !== true ||
        typeof content.bodyRef !== 'string' || !content.bodyRef) {
      // Use the same response for absent and denied bodies; do not reveal whether
      // the private body object exists or whether the caller lacks membership.
      return privateError(404, 'NOT_FOUND')
    }

    const resolved = resolveBodyObjectKey(content.bodyRef)
    if (!resolved) return privateError(404, 'NOT_FOUND')
    const filename = resolved.key.slice(resolved.key.lastIndexOf('/') + 1)
    // W03 owns content authority; W01's existing Payload Media collection owns
    // R2 asset ownership. Both checks are required before the body bytes are read.
    if (!await isBodyAssetOwnedByContentOwner(content.bodyRef, filename, content.ownerUserId)) {
      return privateError(404, 'NOT_FOUND')
    }

    const url = new URL(request.url)
    const previewOnly = url.searchParams.get('preview') === '1'
    if (url.searchParams.has('preview') && !previewOnly) return privateError(400, 'VALIDATION_FAILED')
    const maxBytes = previewOnly ? BODY_PREVIEW_MAX_BYTES : BODY_DETAIL_MAX_BYTES

    let bucket: ContentBodyR2Bucket | undefined
    try {
      const cloudflare = await getCloudflareContext({ async: true })
      bucket = (cloudflare.env as unknown as { R2?: ContentBodyR2Bucket }).R2
    } catch {
      return privateError(503, 'SERVICE_UNAVAILABLE')
    }
    if (!bucket) return privateError(503, 'SERVICE_UNAVAILABLE')

    let metadata: Awaited<ReturnType<ContentBodyR2Bucket['head']>>
    try {
      metadata = await bucket.head(resolved.key)
    } catch {
      return privateError(503, 'SERVICE_UNAVAILABLE')
    }
    if (!metadata) return privateError(404, 'NOT_FOUND')
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 1) return privateError(404, 'NOT_FOUND')
    if (metadata.size > maxBytes) return privateError(413, 'CONTENT_BODY_TOO_LARGE')

    const actualContentType = (metadata.httpMetadata?.contentType ?? '').split(';', 1)[0]!.trim().toLowerCase()
    const expectedContentType = resolved.contentType.startsWith('application/json')
      ? 'application/json'
      : 'text/plain'
    if (actualContentType !== expectedContentType) return privateError(404, 'NOT_FOUND')

    let object: ContentBodyR2Object | null
    try {
      object = await bucket.get(resolved.key)
    } catch {
      return privateError(503, 'SERVICE_UNAVAILABLE')
    }
    if (!object || object.size !== metadata.size || object.size > maxBytes) return privateError(404, 'NOT_FOUND')

    return new Response(object.body, {
      status: 200,
      headers: {
        'content-type': resolved.contentType,
        'content-length': String(object.size),
        'cache-control': 'private, no-store',
        'cdn-cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W03ContentClientError) return privateError(503, 'SERVICE_UNAVAILABLE')
    return privateError(503, 'SERVICE_UNAVAILABLE')
  }
}
