import { cachedPublicGet } from '../../../../lib/public-response-cache.js'
import { enrichContentListAuthors } from '../../../../lib/enrich-public-authors.js'
import { mediaReferenceValidationResponse, validateOwnedPostMediaReferences } from '../../../../content/validate-owned-post-media-references.js'
import {
  ContentListQueryError,
  hasAuthenticatedSessionCredential,
  validateContentListQuery,
} from '../../../../lib/content-list-cache-guard.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../auth/traffic-limit.js'

import {
  callW03Content,
  resolveCookieContentPrincipal,
  resolveVerifiedContentCreatorId,
  W03ContentClientError,
} from '../../../../content/w03-content-client.js'

const unavailable = (error: W03ContentClientError, message = error.message || 'Content service unavailable') =>
  Response.json(
    { error: { code: error.code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: error.status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const query = validateContentListQuery(url)
    const suffix = query.toString() ? `?${query.toString()}` : ''

    // Never put an authenticated request into the shared public cache. This
    // includes both the Payload auth cookie and Authorization credentials.
    if (hasAuthenticatedSessionCredential(request)) {
      const principal = await resolveCookieContentPrincipal(request)
      if (principal instanceof Response) return principal
      const response = await callW03Content({
        request,
        pathname: `/internal/content/contents${suffix}`,
        method: 'GET',
        principal,
      })
      return await enrichContentListAuthors(response)
    }

    await enforcePublicReadRateLimit(request)
    return await cachedPublicGet(
      request,
      'content-list',
      async () => enrichContentListAuthors(await callW03Content({
        request,
        pathname: `/internal/content/contents${suffix}`,
        method: 'GET',
      })),
      30,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W03ContentClientError) return unavailable(error)
    if (error instanceof ContentListQueryError) {
      return unavailable(new W03ContentClientError(error.status, error.code, 'Invalid content query'), 'Invalid content query')
    }
    return unavailable(new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable'))
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) {
      return Response.json(
        { error: { code: 'PRECONDITION_REQUIRED', message: 'Idempotency-Key required', details: {} }, requestId: `req_${crypto.randomUUID()}` },
        { status: 428 },
      )
    }
    if (idempotencyKey.length > 256) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid Idempotency-Key header', details: {} }, requestId: `req_${crypto.randomUUID()}` },
        { status: 422 },
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid content request', details: {} }, requestId: `req_${crypto.randomUUID()}` },
        { status: 422 },
      )
    }

    const mediaValidation = await validateOwnedPostMediaReferences(principal.userId, body, new URL(request.url).origin)
    if ('status' in mediaValidation) return mediaReferenceValidationResponse(mediaValidation)

    let verifiedCreatorId: string | undefined
    if (body && typeof body === 'object' && !Array.isArray(body) &&
        (body as { accessMode?: unknown }).accessMode === 'MEMBERS_ONLY') {
      const resolved = await resolveVerifiedContentCreatorId(request, principal)
      if (resolved instanceof Response) return resolved
      verifiedCreatorId = resolved
    }

    const response = await callW03Content({
      request,
      pathname: '/internal/content/contents',
      method: 'POST',
      body,
      principal,
      verifiedCreatorId,
    })
    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) return unavailable(error)
    return unavailable(new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable'))
  }
}
