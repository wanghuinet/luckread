import { resolvePublicArticleBodyUrl } from '../lib/article-summary-preview.js'
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
  const bodyUrl = resolvePublicArticleBodyUrl(content.bodyRef, requestUrl.origin)
  if (!bodyUrl) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body reference is not a trusted LuckRead asset')
  }

  const resolvedBodyUrl = new URL(bodyUrl)
  const assetHeaders = new Headers({ accept: 'text/plain' })
  // Payload media is private to its owner. The same-origin fetch must carry
  // the current Better Auth credential so Payload's auth strategy can enforce
  // that ownership. Never forward credentials to a CDN or other subdomain.
  if (resolvedBodyUrl.origin === requestUrl.origin) {
    const authorization = request.headers.get('authorization')
    const cookie = request.headers.get('cookie')
    if (authorization) assetHeaders.set('authorization', authorization)
    if (cookie) assetHeaders.set('cookie', cookie)
  }

  let assetResponse: Response
  try {
    assetResponse = await fetch(bodyUrl, {
      method: 'GET',
      headers: assetHeaders,
      redirect: 'manual',
    })
  } catch {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified')
  }
  if (!assetResponse.ok || assetResponse.status >= 300) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified')
  }

  const canonicalBody = await readBoundedUtf8(assetResponse)
  if (canonicalBody === null || !canonicalBody.trim()) {
    return makeErrorResponse(422, 'VALIDATION_FAILED', 'Stored post body is empty or exceeds the verification limit')
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
