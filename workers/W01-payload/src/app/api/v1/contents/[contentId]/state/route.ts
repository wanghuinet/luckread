import {
  invalidatePublicContentComments,
  invalidatePublicContentDetail,
  invalidatePublicContentList,
  invalidatePublicContentVisibility,
  invalidatePublicContentRelationships,
} from '../../../../../../lib/public-response-cache.js'

import {
  callW03Content,
  resolveContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'

import { resolvePublicArticleBodyUrl } from '../../../../../../lib/article-summary-preview.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )


type ContentForPublishCheck = {
  contentType?: unknown
  title?: unknown
  bodyRef?: unknown
  mediaRefs?: unknown
  coverRef?: unknown
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

// Direct post publication must inspect the stored Payload/R2 body, not trust
// the editor snapshot sent by a browser. W03 still recomputes the final verdict.
const bindPreflightToStoredPost = async (
  request: Request,
  contentId: string,
  principal: Awaited<ReturnType<typeof resolveContentPrincipal>> extends infer T ? Exclude<T, Response> : never,
  submitted: unknown,
): Promise<unknown | Response> => {
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
  if (content.contentType !== 'post') return submitted
  if (typeof content.title !== 'string' || typeof content.bodyRef !== 'string' || !Array.isArray(content.mediaRefs)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Stored post content is incomplete')
  }

  const bodyUrl = resolvePublicArticleBodyUrl(content.bodyRef, new URL(request.url).origin)
  if (!bodyUrl) return errorResponse(422, 'VALIDATION_FAILED', 'Stored post body reference is not a trusted LuckRead asset')
  let assetResponse: Response
  try {
    assetResponse = await fetch(bodyUrl, { method: 'GET', headers: { accept: 'text/plain' }, redirect: 'manual' })
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified')
  }
  if (!assetResponse.ok || assetResponse.status >= 300) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Stored post body could not be verified')
  }
  const canonicalBody = await readBoundedUtf8(assetResponse)
  if (canonicalBody === null || !canonicalBody.trim()) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Stored post body is empty or exceeds the verification limit')
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

const requireStatePreconditions = (request: Request): Response | null => {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
  if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match required')
  if (ifMatch.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid If-Match header')
  if (ifMatch === '*') {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  }
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal
    const preconditionError = requireStatePreconditions(request)
    if (preconditionError) return preconditionError
    const submitted = await request.json()
    const boundSubmission = await bindPreflightToStoredPost(request, contentId, principal, submitted)
    if (boundSubmission instanceof Response) return boundSubmission
    const response = await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/state`,
      method: 'POST',
      body: boundSubmission,
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentComments(contentId)
      await invalidatePublicContentVisibility(contentId)
      await invalidatePublicContentRelationships(contentId)
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }
    return response
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content request')
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
