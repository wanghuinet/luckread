
import {
  callW03Content,
  W03ContentClientError,
} from '../../../../../content/w03-content-client.js'
import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

const parseQueryTarget = (request: Request): { targetType: string; targetId: string } | Response => {
  const url = new URL(request.url)
  const targetType = url.searchParams.get('targetType')
  const targetId = url.searchParams.get('targetId')
  if (!targetType || !targetId) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark target')
  }
  return { targetType, targetId }
}

const parseTarget = async (request: Request): Promise<{ targetType: string; targetId: string } | Response> => {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const targetType = (value as { targetType?: unknown }).targetType
    const targetId = (value as { targetId?: unknown }).targetId
    if (typeof targetType !== 'string' || typeof targetId !== 'string') throw new Error('invalid')
    return { targetType, targetId }
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark target')
  }
}

async function forwardList(request: Request, principal: { userId: string; layer: string | null }): Promise<Response> {
  const url = new URL(request.url)
  const allowed = new Set(['list', 'limit', 'cursor'])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark list query')
    }
  }
  if (url.searchParams.get('list') !== 'true') {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark list query')
  }
  const rawLimit = url.searchParams.get('limit')?.trim() ?? ''
  if (rawLimit && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark list limit')
  }
  const cursor = url.searchParams.get('cursor')
  if (cursor && cursor.length > 2048) return errorResponse(422, 'INVALID_CURSOR', 'Invalid bookmark list cursor')

  const query = new URLSearchParams({ limit: rawLimit || '20' })
  if (cursor) query.set('cursor', cursor)
  const bookmarkResponse = await callW05Social({
    request,
    pathname: '/internal/social/interactions/bookmarks/list?' + query.toString(),
    method: 'GET',
    principal,
  })
  if (!bookmarkResponse.ok) return bookmarkResponse

  const bookmarkPayload = await bookmarkResponse.json().catch((_cause: unknown): null => null) as {
    data?: { items?: Array<{ targetId?: unknown; createdAt?: unknown }>; nextCursor?: string | null; hasMore?: boolean }
  } | null
  const favoriteItems = bookmarkPayload?.data?.items
  const nextCursor = bookmarkPayload?.data?.nextCursor ?? null
  const hasMore = bookmarkPayload?.data?.hasMore === true
  if (!Array.isArray(favoriteItems) || favoriteItems.some(item =>
    typeof item.targetId !== 'string' || typeof item.createdAt !== 'string'
  )) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Bookmark list unavailable')
  }

  const ids = favoriteItems.map(item => item.targetId as string)
  if (ids.length === 0) {
    return Response.json(
      { data: { items: [], nextCursor, hasMore }, requestId: `req_${crypto.randomUUID()}` },
      { headers: { 'cache-control': 'no-store' } },
    )
  }

  const contentResponse = await callW03Content({
    request,
    pathname: '/internal/content/bookmarked-items',
    method: 'POST',
    body: { ids },
    principal,
  })
  if (!contentResponse.ok) return contentResponse

  const contentPayload = await contentResponse.json().catch((_cause: unknown): null => null) as {
    data?: { items?: Array<Record<string, unknown>> }
  } | null
  const contents = contentPayload?.data?.items
  if (!Array.isArray(contents)) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Bookmark content unavailable')
  const contentById = new Map<string, Record<string, unknown>>(contents
    .filter(item => typeof item.id === 'string')
    .map(item => [item.id as string, item] as const))
  const items = ids.flatMap(id => {
    const item = contentById.get(id)
    return item ? [item] : []
  })

  return Response.json(
    { data: { items, nextCursor, hasMore }, requestId: `req_${crypto.randomUUID()}` },
    { headers: { 'cache-control': 'no-store' } },
  )
}

async function forward(request: Request, method: 'GET' | 'POST' | 'DELETE'): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    if (method === 'GET' && new URL(request.url).searchParams.get('list') === 'true') {
      return await forwardList(request, principal)
    }

    if (method !== 'GET') {
      const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
      if (!idempotencyKey) {
        return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
      }
      if (idempotencyKey.length > 256) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
      }
    }

    const target = method === 'GET' ? parseQueryTarget(request) : await parseTarget(request)
    if (target instanceof Response) return target

    const pathname = method === 'GET'
      ? '/internal/social/interactions/bookmarks?targetType=' + encodeURIComponent(target.targetType) + '&targetId=' + encodeURIComponent(target.targetId)
      : '/internal/social/interactions/bookmarks'

    return await callW05Social({
      request,
      pathname,
      method,
      principal,
      body: method === 'GET' ? undefined : target,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function GET(request: Request): Promise<Response> {
  return forward(request, 'GET')
}

export async function POST(request: Request): Promise<Response> {
  return forward(request, 'POST')
}

export async function DELETE(request: Request): Promise<Response> {
  return forward(request, 'DELETE')
}
