import { getCloudflareContext } from '@opennextjs/cloudflare'
import { resolvePublicArticleBodyUrl } from '../lib/article-summary-preview.js'
import { mediaHostKind, resolveMediaObjectKey } from '../media/media-delivery.js'
import { validateOwnedPostMediaReferences } from './validate-owned-post-media-references.js'
import { callW03Content, type ContentPrincipal } from './w03-content-client.js'

type ContentForPublishCheck = {
  contentType?: unknown
  state?: unknown
  title?: unknown
  bodyRef?: unknown
  mediaRefs?: unknown
  coverRef?: unknown
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

async function readStoredPostBody(
  bodyUrl: string,
  currentOrigin: string,
  request: Request,
): Promise<string | null> {
  let url: URL
  try {
    url = new URL(bodyUrl)
  } catch {
    return null
  }

  if (url.search || url.hash || url.username || url.password) return null

  // Private draft media must not be fetched through img/video.luckread.com:
  // those delivery URLs intentionally require owner authentication until W03
  // records the containing post as public. Instead, after the caller verifies
  // the exact Payload Media record belongs to this identity, read the same
  // object through W01's existing R2 binding. No bearer token or cookie leaves
  // the API origin and the public-media access policy is not weakened.
  if (mediaHostKind(url.hostname)) {
    let key: string | null = null
    try {
      const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
      key = resolveMediaObjectKey(segments)
    } catch {
      return null
    }
    if (!key) return null

    let bucket: R2MediaBucket | undefined
    try {
      const cloudflare = await getCloudflareContext({ async: true })
      bucket = (cloudflare.env as unknown as R2MediaEnvironment).R2
    } catch {
      return null
    }
    if (!bucket) return null

    let object: R2MediaObjectBody | null
    try {
      object = await bucket.get(key)
    } catch {
      return null
    }
    if (!object) return null

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
      return null
    }

    return readBoundedUtf8(new Response(object.body, {
      headers: { 'content-length': String(object.size) },
    }), POST_BODY_MAX_BYTES)
  }

  // Retain same-origin local-development support; never send credentials to
  // arbitrary LuckRead subdomains or third-party hosts.
  let current: URL
  try {
    current = new URL(currentOrigin)
  } catch {
    return null
  }
  if (url.origin !== current.origin) return null

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
    return null
  }
  if (!response.ok || response.status >= 300) {
    await response.body?.cancel().catch((): undefined => undefined)
    return null
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase()
  if (contentType !== 'text/plain') {
    await response.body?.cancel().catch((): undefined => undefined)
    return null
  }
  return readBoundedUtf8(response, POST_BODY_MAX_BYTES)
}

const readBoundedUtf8 = async (response: Response, maxBytes = 16_384): Promise<string | null> => {
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    await reader.cancel().catch((): undefined => undefined)
    return null
  }
}

/**
 * Bind publish preflight to W03's stored post metadata and the existing
 * LuckRead-hosted body asset. Never trust the browser's body/media snapshot
 * when authorizing a draft post's direct transition to PUBLISHED.
 */
export async function bindPreflightToStoredPost(
  request: Request,
  contentId: string,
  principal: ContentPrincipal,
  submitted: unknown,
  makeErrorResponse: ErrorResponseFactory,
): Promise<unknown | Response> {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return submitted
  const mutation = submitted as Record<string, unknown>
  if (mutation.to !== 'PUBLISHED') return submitted
  if (!mutation.preflight || typeof mutation.preflight !== 'object' || Array.isArray(mutation.preflight)) return submitted

  const contentResponse = await callW03Content({
    request,
    pathname: `/internal/content/contents/${encodeURIComponent(contentId)}`,
    method: 'GET',
    principal,
  })
  if (!contentResponse.ok) return contentResponse

  const content = await contentResponse.json() as ContentForPublishCheck
  if (content.contentType !== 'post' || content.state !== 'DRAFT') return submitted
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

  const canonicalBody = await readStoredPostBody(bodyUrl, requestUrl.origin, request)
  if (canonicalBody === null || !canonicalBody.trim()) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified, is empty, or exceeds the verification limit')
  }

  const preflight = mutation.preflight as Record<string, unknown>
  return {
    ...mutation,
    preflight: {
      ...preflight,
      contentType: 'post',
      title: content.title,
      body: canonicalBody,
      mediaRefs: content.mediaRefs,
      coverRef: typeof content.coverRef === 'string' ? content.coverRef : null,
    },
  }
}
