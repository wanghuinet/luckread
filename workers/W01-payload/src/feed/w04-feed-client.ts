import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { ContentPrincipal } from '../content/w03-content-client.js'

type W04FeedService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W04FeedClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function getW04FeedService(): Promise<W04FeedService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W04_FEED?: W04FeedService }).W04_FEED
  if (!service) throw new W04FeedClientError(503, 'SERVICE_UNAVAILABLE', 'Feed service unavailable')
  return service
}

export async function callW04FollowingFeed(input: {
  request: Request
  pathname: string
  principal: ContentPrincipal
}): Promise<Response> {
  const service = await getW04FeedService()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Principal-User-Id': input.principal.userId,
    'X-LuckRead-Rate-Key': 'user:' + input.principal.userId,
  })
  if (input.principal.layer) headers.set('X-LuckRead-Principal-Layer', input.principal.layer)

  const response = await service.fetch(
    new Request('https://luckread-w04.internal' + input.pathname, { method: 'GET', headers }),
  )
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function callW04ContentSearch(input: {
  request: Request
  pathname: string
}): Promise<Response> {
  const service = await getW04FeedService()
  const clientIp = input.request.headers.get('cf-connecting-ip')?.trim()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Rate-Key': clientIp ? 'ip:' + clientIp : 'transport:W01',
  })

  const response = await service.fetch(
    new Request('https://luckread-w04.internal' + input.pathname, { method: 'GET', headers }),
  )
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}


/**
 * Public, aggregate search trend read. No caller credentials or viewer identity
 * cross the W01→W04 boundary; results are a disposable discovery projection.
 */
export async function callW04TrendingSearches(input: {
  request: Request
  pathname: string
}): Promise<Response> {
  const service = await getW04FeedService()
  const clientIp = input.request.headers.get('cf-connecting-ip')?.trim()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Rate-Key': clientIp ? 'ip:' + clientIp : 'transport:W01',
  })

  const response = await service.fetch(
    new Request('https://luckread-w04.internal' + input.pathname, { method: 'GET', headers }),
  )
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
