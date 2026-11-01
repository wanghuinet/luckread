import { getCloudflareContext } from '@opennextjs/cloudflare'
import { resolvePublicArticleBodyUrl } from '../lib/article-summary-preview.js'
import { resolveMediaObjectKey } from '../media/media-delivery.js'
import { PUBLIC_IMAGE_MEDIA_ORIGIN } from '../media/public-media-url.js'
import { validateOwnedPostMediaReferences } from './validate-owned-post-media-references.js'
import { callW03Content, resolveVerifiedContentCreatorId, type ContentPrincipal } from './w03-content-client.js'

type ContentForPublishCheck = {
  contentType?: unknown
  state?: unknown
  title?: unknown
  bodyRef?: unknown
  mediaRefs?: unknown
  coverRef?: unknown
  accessMode?: unknown
  creatorId?: unknown
}

type ErrorResponseFactory = (status: number, code: string, message: string) => Response

type R2MediaObjectBody = {
  size: number
  httpMetadata?: { contentType?: string }
  body: ReadableStream<Uint8Array>
}

type R2MediaBucket = {
  get: (key: string) => Promise<R2MediaObjectBody | null>
}

type R2MediaEnvironment = { R2?: R2MediaBucket }

const POST_BODY_MAX_BYTES = 16_384

type StoredPostBodyReadResult =
  | { ok: true; body: string }
  | { ok: false; status: 422 | 503 }

async function readStoredPostBody(
  bodyUrl: string,
  currentOrigin: string,
  request: Request,
): Promise<StoredPostBodyReadResult> {
  let url: URL
  try {
    url = new URL(bodyUrl)
  } catch {
    return { ok: false, status: 422 }
  }

  if (url.search || url.hash || url.username || url.password) return { ok: false, status: 422 }

  // Private draft media must not be fetched through img/video.luckread.com:
  // those delivery URLs intentionally require owner authentication until W03
  // records the containing post as public. Instead, after the caller verifies
  // the exact Payload Media record belongs to this identity, read the same
  // object through W01's existing R2 binding. No bearer token or cookie leaves
  // the API origin and the public-media access policy is not weakened.
  if (url.origin === PUBLIC_IMAGE_MEDIA_ORIGIN) {
    let key: string | null = null
    try {
      const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
      key = resolveMediaObjectKey(segments)
    } catch {
      return { ok: false, status: 422 }
    }
    if (!key) return { ok: false, status: 422 }

    let bucket: R2MediaBucket | undefined
    try {
      const cloudflare = await getCloudflareContext({ async: true })
      bucket = (cloudflare.env as unknown as R2MediaEnvironment).R2
    } catch {
      return { ok: false, status: 503 }
    }
    if (!bucket) return { ok: false, status: 503 }

    let object: R2MediaObjectBody | null
    try {
      object = await bucket.get(key)
    } catch {
      return { ok: false, status: 503 }
    }
    if (!object) return { ok: false, status: 422 }

    const contentType = (object.httpMetadata?.contentType ?? '')
      .split(';', 1)[0]!
      .trim()
      .toLowerCase()
    if (
      contentType !== 'text/plain' ||
      !Number.isSafeInteger(object.size) ||
      object.size < 1 ||
      object.size > POST_BODY_MAX_BYTES
    ) {
      await object.body.cancel().catch((): undefined => undefined)
      return { ok: false, status: 422 }
    }

    const body = await readBoundedUtf8(new Response(object.body, {
      headers: { 'content-length': String(object.size) },
    }), POST_BODY_MAX_BYTES)
    if (body.ok === false) {
      const failureStatus = body.reason === 'unavailable' ? 503 : 422
      return { ok: false, status: failureStatus }
    }
    return { ok: true, body: body.body }
  }

  // Retain authenticated same-origin reads for local development only; never
  // send credentials to arbitrary LuckRead subdomains or third-party hosts.
  let current: URL
  try {
    current = new URL(currentOrigin)
  } catch {
    return { ok: false, status: 422 }
  }
  if (url.origin !== current.origin) return { ok: false, status: 422 }

  const assetHeaders = new Headers({ accept: 'text/plain' })
  const authorization = request.headers.get('authorization')
  const cookie = request.headers.get('cookie')
  if (authorization) assetHeaders.set('authorization', authorization)
  if (cookie) assetHeaders.set('cookie', cookie)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: assetHeaders,
      redirect: 'manual',
    })
  } catch {
    return { ok: false, status: 503 }
  }
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel().catch((): undefined => undefined)
    return { ok: false, status: response.status >= 500 ? 503 : 422 }
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase()
  if (contentType !== 'text/plain') {
    await response.body?.cancel().catch((): undefined => undefined)
    return { ok: false, status: 422 }
  }
  const body = await readBoundedUtf8(response, POST_BODY_MAX_BYTES)
  if (body.ok === false) {
    const failureStatus = body.reason === 'unavailable' ? 503 : 422
    return { ok: false, status: failureStatus }
  }
  return { ok: true, body: body.body }
}
type BoundedUtf8ReadResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'invalid' | 'unavailable' }

const readBoundedUtf8 = async (
  response: Response,
  maxBytes = 16_384,
): Promise<BoundedUtf8ReadResult> => {
  const reader = response.body?.getReader()
  if (!reader) return { ok: false, reason: 'invalid' }
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch((): undefined => undefined)
        return { ok: false, reason: 'invalid' }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return { ok: true, body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  } catch {
    await reader.cancel().catch((): undefined => undefined)
    return { ok: false, reason: 'unavailable' }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Bind publish preflight to W03's stored post metadata and the existing
 * LuckRead-hosted body asset. Never trust the browser's body/media snapshot
 * when authorizing a draft post's direct transition to PUBLISHED.
 */
export type BoundPostPublishPreflight = Readonly<{
  body: unknown
  verifiedCreatorId?: string
}>

export async function bindPreflightToStoredPost(
  request: Request,
  contentId: string,
  principal: ContentPrincipal,
  submitted: unknown,
  makeErrorResponse: ErrorResponseFactory,
): Promise<BoundPostPublishPreflight | Response> {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return { body: submitted }
  const mutation = submitted as Record<string, unknown>
  if (mutation.to !== 'PUBLISHED' && mutation.to !== 'SCHEDULED') return { body: submitted }

  const contentResponse = await callW03Content({
    request,
    pathname: `/internal/content/contents/${encodeURIComponent(contentId)}`,
    method: 'GET',
    principal,
  })
  if (!contentResponse.ok) return contentResponse

  const content = await contentResponse.json() as ContentForPublishCheck
  let verifiedCreatorId: string | undefined
  if (content.accessMode === 'MEMBERS_ONLY') {
    const verified = await resolveVerifiedContentCreatorId(request, principal)
    if (verified instanceof Response) return verified
    if (typeof content.creatorId !== 'string' || verified !== content.creatorId) {
      return makeErrorResponse(403, 'PERMISSION_DENIED', 'An active matching creator identity is required to publish member-only content')
    }
    verifiedCreatorId = verified
  }

  // Only direct publication of a draft social post needs the canonical body/media
  // rebinding. Creator article/video transitions still receive the verified ID.
  if (mutation.to !== 'PUBLISHED' || content.contentType !== 'post' || content.state !== 'DRAFT' ||
      !mutation.preflight || typeof mutation.preflight !== 'object' || Array.isArray(mutation.preflight)) {
    return { body: submitted, ...(verifiedCreatorId ? { verifiedCreatorId } : {}) }
  }
  if (typeof content.title !== 'string' || typeof content.bodyRef !== 'string' || !Array.isArray(content.mediaRefs)) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post content is incomplete')
  }

  const requestUrl = new URL(request.url)
  const mediaValidation = await validateOwnedPostMediaReferences(principal.userId, content, requestUrl.origin)
  if ('status' in mediaValidation) {
    return makeErrorResponse(mediaValidation.status, mediaValidation.code, mediaValidation.message)
  }

  const bodyUrl = resolvePublicArticleBodyUrl(content.bodyRef, requestUrl.origin)
  if (!bodyUrl) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body reference is not a trusted LuckRead asset')
  }

  const bodyRead = await readStoredPostBody(bodyUrl, requestUrl.origin, request)
  if ('status' in bodyRead) {
    return bodyRead.status === 503
      ? makeErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
      : makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified, is empty, or exceeds the verification limit')
  }
  const canonicalBody = bodyRead.body
  if (!canonicalBody.trim()) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified, is empty, or exceeds the verification limit')
  }

  const preflight = mutation.preflight as Record<string, unknown>
  return {
    body: {
      ...mutation,
      preflight: {
        ...preflight,
        contentType: 'post',
        title: content.title,
        body: canonicalBody,
        mediaRefs: content.mediaRefs,
        coverRef: typeof content.coverRef === 'string' ? content.coverRef : null,
      },
    },
    ...(verifiedCreatorId ? { verifiedCreatorId } : {}),
  }
}
