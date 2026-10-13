import { getCloudflareContext } from '@opennextjs/cloudflare'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../auth/traffic-limit.js'
import { getBetterAuthPrincipal, W02AuthClientError } from '../auth/w02-session-client.js'

type W03ContentService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type ContentPrincipal = {
  userId: string
  layer: string | null
}

export class W03ContentClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function getW03Service(): Promise<W03ContentService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W03_CONTENT?: W03ContentService }).W03_CONTENT
  if (!service) {
    throw new W03ContentClientError(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
  return service
}

export async function resolveContentPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const principal = await getBetterAuthPrincipal(request)
    if (!principal.active) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    return { userId: principal.userId, layer: principal.layer ?? null }
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W02AuthClientError && error.status === 401) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}

export async function resolveCookieContentPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  return resolveContentPrincipal(request)
}

export async function resolveOptionalContentPrincipal(request: Request): Promise<ContentPrincipal | Response | null> {
  if (!request.headers.get('Authorization') && !request.headers.get('cookie')) return null
  return resolveContentPrincipal(request)
}

export async function resolveOptionalCookieContentPrincipal(request: Request): Promise<ContentPrincipal | Response | null> {
  return resolveOptionalContentPrincipal(request)
}

export async function callW03Content(input: {
  request: Request
  pathname: string
  method: string
  body?: unknown
  principal?: ContentPrincipal | null
}): Promise<Response> {
  const service = await getW03Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id':
      input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
  })

  if (input.principal?.userId) {
    headers.set('X-LuckRead-Principal-User-Id', input.principal.userId)
    headers.set('X-LuckRead-Rate-Key', 'user:' + input.principal.userId)
  } else {
    const clientIp = input.request.headers.get('cf-connecting-ip')?.trim()
    if (clientIp) {
      headers.set('X-LuckRead-Client-IP', clientIp)
      headers.set('X-LuckRead-Rate-Key', 'ip:' + clientIp)
    }
  }
  if (input.principal?.layer) {
    headers.set('X-LuckRead-Principal-Layer', input.principal.layer)
  }

  const ifMatch = input.request.headers.get('If-Match')
  if (ifMatch) headers.set('If-Match', ifMatch)

  const idempotencyKey = input.request.headers.get('Idempotency-Key')
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

  let body: BodyInit | undefined
  if (input.body !== undefined) {
    headers.set('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(input.body)
  }

  const response = await service.fetch(
    new Request(`https://luckread-w03.internal${input.pathname}`, {
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
