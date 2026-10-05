import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { ContentPrincipal } from '../content/w03-content-client.js'

type W06ModerationService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W06ModerationClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function getW06Service(): Promise<W06ModerationService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W06_MODERATION?: W06ModerationService }).W06_MODERATION
  if (!service) throw new W06ModerationClientError(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  return service
}

const requestId = (request: Request): string => {
  const value = request.headers.get('X-LuckRead-Request-Id')?.trim()
  return value && /^req_[A-Za-z0-9_-]{1,123}$/.test(value)
    ? value
    : `req_${crypto.randomUUID().replaceAll('-', '')}`
}

export async function callW06Moderation(input: {
  request: Request
  pathname: string
  method: string
  principal: ContentPrincipal
  body?: unknown
}): Promise<Response> {
  if (!input.principal.userId || !input.principal.layer) {
    return Response.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', details: {} }, requestId: crypto.randomUUID() },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const service = await getW06Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Principal-User-Id': input.principal.userId,
    'X-LuckRead-Principal-Layer': input.principal.layer,
    'X-LuckRead-Correlation-Id':
      input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Request-Id': requestId(input.request),
  })

  const ifMatch = input.request.headers.get('If-Match')
  const idempotencyKey = input.request.headers.get('Idempotency-Key')
  if (ifMatch) headers.set('If-Match', ifMatch)
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

  let body: BodyInit | undefined
  if (input.body !== undefined) {
    headers.set('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(input.body)
  }

  const response = await service.fetch(
    new Request(`https://luckread-w06.internal${input.pathname}`, {
      method: input.method,
      headers,
      body,
    }),
  )

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
