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
  verifiedCreatorId?: string
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
  if (input.verifiedCreatorId !== undefined) {
    const creatorId = input.verifiedCreatorId.trim()
    if (!creatorId || creatorId.length > 256) throw new W07SubscriptionClientError(403, 'PERMISSION_DENIED', 'Creator identity is unavailable')
    headers.set('X-LuckRead-Verified-Creator-Id', creatorId)
  }
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


/**
 * Relay a provider callback to W07 without parsing or re-serializing the signed
 * payload. Only the exact raw bytes, signature and generated transport
 * metadata cross the Service Binding; browser credentials and arbitrary
 * request headers are not forwarded.
 */
export async function forwardW07HyperswitchWebhook(input: {
  request: Request
  rawBody: ArrayBuffer
}): Promise<Response> {
  const service = await getW07Service()
  const suppliedCorrelation = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  const correlationId = suppliedCorrelation.length > 0 &&
    suppliedCorrelation.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(suppliedCorrelation)
    ? suppliedCorrelation
    : crypto.randomUUID()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': correlationId,
    'content-type': 'application/json',
  })
  const signature = input.request.headers.get('X-Webhook-Signature-512')
  if (signature !== null) headers.set('X-Webhook-Signature-512', signature)

  const response = await service.fetch(new Request('https://luckread-w07.internal/internal/webhooks/hyperswitch', {
    method: 'POST',
    headers,
    body: input.rawBody,
  }))
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Relay an authenticated RevenueCat callback without changing signed payload bytes. */
export async function forwardW07RevenueCatWebhook(input: {
  request: Request
  rawBody: ArrayBuffer
}): Promise<Response> {
  const service = await getW07Service()
  const suppliedCorrelation = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  const correlationId = suppliedCorrelation.length > 0 &&
    suppliedCorrelation.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(suppliedCorrelation)
    ? suppliedCorrelation
    : crypto.randomUUID()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': correlationId,
    'content-type': 'application/json',
  })
  // This is the one configured RevenueCat webhook Authorization value, not a
  // browser session. No Cookie, user Authorization from a session, or arbitrary
  // client header is copied to W07.
  const authorization = input.request.headers.get('Authorization')
  const signature = input.request.headers.get('X-RevenueCat-Webhook-Signature')
  if (authorization !== null) headers.set('Authorization', authorization)
  if (signature !== null) headers.set('X-RevenueCat-Webhook-Signature', signature)

  const response = await service.fetch(new Request('https://luckread-w07.internal/internal/webhooks/revenuecat', {
    method: 'POST',
    headers,
    body: input.rawBody,
  }))
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
