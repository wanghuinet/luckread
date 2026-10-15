import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../content/w03-content-client.js'

type FeedServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(request: Request): Promise<Response> {
  const principal = await resolveCookieContentPrincipal(request)
  if (principal instanceof Response) return principal

  const url = new URL(request.url)
  if (
    [...url.searchParams.keys()].some((key) => !['cursor', 'limit'].includes(key)) ||
    url.searchParams.getAll('cursor').length > 1 ||
    url.searchParams.getAll('limit').length > 1
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Following feed query')
  }

  const cursor = url.searchParams.get('cursor')
  const limit = url.searchParams.get('limit')
  if (
    (cursor !== null && (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
    (limit !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit))
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Following feed query')
  }

  try {
    const context = await getCloudflareContext({ async: true })
    const service = (context.env as unknown as { W04_FEED?: FeedServiceBinding }).W04_FEED
    if (!service) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Following feed is unavailable')

    const target = new URL('https://luckread-w04.internal/internal/feed/following')
    if (cursor !== null) target.searchParams.set('cursor', cursor)
    if (limit !== null) target.searchParams.set('limit', limit)

    const headers = new Headers({
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id':
        request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
      'X-LuckRead-Principal-User-Id': principal.userId,
      'X-LuckRead-Rate-Key': 'user:' + principal.userId,
    })
    const clientIp = request.headers.get('cf-connecting-ip')?.trim()
    if (clientIp) headers.set('X-LuckRead-Client-IP', clientIp)

    const response = await service.fetch(new Request(target, { method: 'GET', headers }))
    const responseHeaders = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter) responseHeaders.set('retry-after', retryAfter)
    return new Response(await response.arrayBuffer(), { status: response.status, headers: responseHeaders })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Following feed is unavailable')
  }
}
