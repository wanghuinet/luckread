import { cachedPublicGet } from '../../../../../lib/public-response-cache.js'

import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../content/w03-content-client.js'

const unavailable = (error: W03ContentClientError) =>
  Response.json(
    { error: { code: error.code, message: 'Content service unavailable', details: {} }, requestId: crypto.randomUUID() },
    { status: error.status },
  )

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const query = new URLSearchParams()
    const cursor = url.searchParams.get('cursor')
    const limit = url.searchParams.get('limit')
    const creatorId = url.searchParams.get('creatorId')
    const contentType = url.searchParams.get('type')
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', limit)
    if (creatorId) query.set('creatorId', creatorId)
    if (contentType) query.set('type', contentType)
    const suffix = query.toString() ? `?${query.toString()}` : ''

    return await cachedPublicGet(
      request,
      'content-list',
      () => callW03Content({
        request,
        pathname: `/internal/content/contents${suffix}`,
        method: 'GET',
      }),
      30,
    )
  } catch (error) {
    if (error instanceof W03ContentClientError) return unavailable(error)
    return unavailable(new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable'))
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return Response.json(
        { error: { code: 'PRECONDITION_REQUIRED', message: 'Idempotency-Key required', details: {} }, requestId: crypto.randomUUID() },
        { status: 428 },
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid content request', details: {} }, requestId: crypto.randomUUID() },
        { status: 400 },
      )
    }

    return await callW03Content({
      request,
      pathname: '/internal/content/contents',
      method: 'POST',
      body,
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) return unavailable(error)
    return unavailable(new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable'))
  }
}
