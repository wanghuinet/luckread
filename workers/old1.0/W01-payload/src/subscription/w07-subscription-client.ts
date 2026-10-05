import { getCloudflareContext } from '@opennextjs/cloudflare'
import { resolveCookieContentPrincipal, type ContentPrincipal } from '../content/w03-content-client.js'

type W07SubscriptionService = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }

export class W07SubscriptionClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function getW07Service(): Promise<W07SubscriptionService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W07_SUBSCRIPTION?: W07SubscriptionService }).W07_SUBSCRIPTION
  if (!service) throw new W07SubscriptionClientError(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  return service
}

export async function resolveCookieSubscriptionPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  return resolveCookieContentPrincipal(request)
}

export async function callW07Subscription(input: {
  request: Request
  pathname: string
  method: string
  principal: ContentPrincipal
  body?: unknown
}): Promise<Response> {
  const service = await getW07Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Principal-User-Id': input.principal.userId,
  })
  if (input.principal.layer) headers.set('X-LuckRead-Principal-Layer', input.principal.layer)
  if (input.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')
  for (const name of ['Idempotency-Key', 'If-Match']) {
    const value = input.request.headers.get(name)?.trim()
    if (value) headers.set(name, value)
  }
  const response = await service.fetch(new Request('https://luckread-w07.internal' + input.pathname, {
    method: input.method,
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  }))
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    },
  })
}
