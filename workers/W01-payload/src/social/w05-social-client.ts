import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import {
  resolveContentPrincipal,
  resolveCookieContentPrincipal,
  type ContentPrincipal,
} from '../content/w03-content-client.js'
import { extractSocialTokens } from './social-token-parser.js'

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

export async function resolveOptionalCookieSocialPrincipal(
  request: Request,
): Promise<ContentPrincipal | Response | null> {
  if (!request.headers.get('Authorization') && !request.headers.get('cookie')) return null

  const principal = await resolveCookieSocialPrincipal(request)
  if (principal instanceof Response && principal.status === 401) return null
  return principal
}


export type ResolvedSocialMention = { userId: string; handle: string }

export async function resolveSocialMentionTargets(body: string): Promise<ResolvedSocialMention[]> {
  const unique = Array.from(new Set(
    extractSocialTokens(body)
      .filter((token) => token.kind === 'mention')
      .map((token) => token.normalized),
  )).slice(0, 20)
  if (!unique.length) return []

  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'users',
    where: { username: { in: unique } },
    depth: 0,
    limit: unique.length,
    overrideAccess: true,
    select: { id: true, username: true } as any,
  })

  return result.docs
    .map((user) => {
      const username = typeof user.username === 'string' ? user.username.trim() : ''
      if (!username) return null
      return { userId: String(user.id), handle: username }
    })
    .filter((value): value is ResolvedSocialMention => Boolean(value))
}

export async function assertSocialTargetUserExists(targetUserId: string): Promise<void> {
  const normalized = targetUserId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new W05SocialClientError(400, 'VALIDATION_FAILED', 'Invalid target user id')
  }

  const payload = await getPayload({ config })
  const user = await payload.findByID({
    collection: 'users',
    id: normalized,
    depth: 0,
    overrideAccess: true,
  })
  if (!user) throw new W05SocialClientError(404, 'NOT_FOUND', 'Target user not found')
}

export async function callW05SocialPublic(input: {
  request: Request
  pathname: string
  method: string
  principal?: ContentPrincipal | null
}): Promise<Response> {
  const service = await getW05Service()
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

  const response = await service.fetch(
    new Request('https://luckread-w05.internal' + input.pathname, {
      method: input.method,
      headers,
    }),
  )
  const responseHeaders = new Headers({
    'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  const etag = response.headers.get('etag')
  if (etag) responseHeaders.set('etag', etag)

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: responseHeaders,
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
  const ifMatch = input.request.headers.get('If-Match')?.trim()
  if (ifMatch) headers.set('If-Match', ifMatch)

  const response = await service.fetch(
    new Request('https://luckread-w05.internal' + input.pathname, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    }),
  )

  const responseHeaders = new Headers({
    'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  const etag = response.headers.get('etag')
  if (etag) responseHeaders.set('etag', etag)
  const contentId = response.headers.get('X-LuckRead-Content-Id')
  if (contentId) responseHeaders.set('X-LuckRead-Content-Id', contentId)

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: responseHeaders,
  })
}