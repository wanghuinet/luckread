import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const allowedStates = new Set([
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'DELETED',
  'RESTORED',
])

const allowedTypes = new Set(['article', 'post', 'video'])

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const source = new URL(request.url)
    const query = new URLSearchParams()
    const cursor = source.searchParams.get('cursor')
    const limit = source.searchParams.get('limit')
    const state = source.searchParams.get('state')
    const contentType = source.searchParams.get('contentType')

    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', limit)

    if (state) {
      if (state !== 'ALL' && !allowedStates.has(state)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content state')
      }
      query.set('state', state)
    }

    if (contentType) {
      if (contentType !== 'ALL' && !allowedTypes.has(contentType)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content type')
      }
      query.set('contentType', contentType)
    }

    const suffix = query.toString() ? `?${query.toString()}` : ''
    return await callW03Content({
      request,
      pathname: `/internal/content/creator/contents${suffix}`,
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content request')
    }

    return await callW03Content({
      request,
      pathname: '/internal/content/contents',
      method: 'POST',
      body,
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
