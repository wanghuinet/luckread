import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  resolveContentPrincipal,
  resolveCookieContentPrincipal,
  type ContentPrincipal,
} from '../content/w03-content-client.js'

type W05SocialService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W05SocialClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function getW05Service(): Promise<W05SocialService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W05_SOCIAL?: W05SocialService }).W05_SOCIAL
  if (!service) throw new W05SocialClientError(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  return service
}

export async function resolveSocialPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  return resolveContentPrincipal(request)
}

export async function resolveCookieSocialPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  return resolveCookieContentPrincipal(request)
}

export async function callW05SocialPublic(input: {
  request: Request
  pathname: string
  method: string
}): Promise<Response> {
  const service = await getW05Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id':
      input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
  })
  const response = await service.fetch(
    new Request('https://luckread-w05.internal' + input.pathname, {
      method: input.method,
      headers,
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

export async function callW05Social(input: {
  request: Request
  pathname: string
  method: string
  principal: ContentPrincipal
  body?: unknown
}): Promise<Response> {
  const service = await getW05Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Principal-User-Id': input.principal.userId,
  })
  if (input.principal.layer) headers.set('X-LuckRead-Principal-Layer', input.principal.layer)
  if (input.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')
  const idempotencyKey = input.request.headers.get('Idempotency-Key')?.trim()
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

  const response = await service.fetch(
    new Request('https://luckread-w05.internal' + input.pathname, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
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