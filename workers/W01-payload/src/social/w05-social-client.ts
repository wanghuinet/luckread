import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import {
  resolveContentPrincipal,
  resolveCookieContentPrincipal,
  type ContentPrincipal,
} from '../content/w03-content-client.js'
import { extractSocialTokens } from './social-token-parser.js'
import { relayW05Response } from './w05-response.js'

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
    select: { identityId: true, username: true } as any,
  })

  return result.docs
    .map((user) => {
      const identityId = typeof user.identityId === 'string' ? user.identityId.trim() : ''
      const username = typeof user.username === 'string' ? user.username.trim() : ''
      // W05 compares mention targets with the W02 principal ID. Payload's own
      // numeric profile ID belongs to a different identity namespace.
      if (!identityId || !username) return null
      return { userId: identityId, handle: username }
    })
    .filter((value): value is ResolvedSocialMention => Boolean(value))
}

const isPayloadNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const details = error as { status?: unknown; statusCode?: unknown; code?: unknown }
  return details.status === 404 || details.statusCode === 404 || details.code === 'NOT_FOUND'
}

const canonicalIdentityId = (user: unknown): string | null => {
  if (!user || typeof user !== 'object') return null
  const value = (user as { identityId?: unknown }).identityId
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized) ? normalized : null
}

/**
 * Accept either a legacy Payload profile-row ID or a canonical W02 identity ID,
 * but only ever return the identity ID used by W05's social relation tables.
 */
export async function resolveSocialProfileIdentity(
  profileIdValue: string,
): Promise<{ identityId: string; payloadProfileId: string }> {
  const normalized = typeof profileIdValue === 'string' ? profileIdValue.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new W05SocialClientError(400, 'VALIDATION_FAILED', 'Invalid target user id')
  }

  const payload = await getPayload({ config })
  let user: unknown = null
  const isLegacyPayloadId = /^[0-9]+$/.test(normalized)

  // Better Auth IDs are opaque strings, whereas legacy Payload user row IDs
  // are numeric. Resolve the common case with one authoritative lookup.
  if (!isLegacyPayloadId) {
    const byIdentity = await payload.find({
      collection: 'users',
      where: { identityId: { equals: normalized } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      select: { id: true, identityId: true } as any,
    })
    user = byIdentity.docs[0] ?? null
  }

  if (!user) {
    try {
      user = await payload.findByID({
        collection: 'users',
        id: normalized,
        depth: 0,
        overrideAccess: true,
      })
    } catch (error) {
      if (!isPayloadNotFound(error)) throw error
    }
  }

  // Also support numeric identity IDs without treating a missing Payload lookup
  // as a valid social ID.
  if (!user && isLegacyPayloadId) {
    const byIdentity = await payload.find({
      collection: 'users',
      where: { identityId: { equals: normalized } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      select: { id: true, identityId: true } as any,
    })
    user = byIdentity.docs[0] ?? null
  }

  if (!user) throw new W05SocialClientError(404, 'NOT_FOUND', 'Target user not found')
  const record = user as { id?: unknown; identityId?: unknown }
  const identityId = canonicalIdentityId(user)
  if (!identityId) {
    // Missing identity mappings must fail closed rather than create W05 rows
    // in the wrong ID namespace.
    throw new W05SocialClientError(503, 'SERVICE_UNAVAILABLE', 'Profile identity mapping unavailable')
  }
  const rawPayloadId = typeof record.id === 'number' || typeof record.id === 'string'
    ? String(record.id).trim()
    : ''
  const payloadProfileId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rawPayloadId)
    ? rawPayloadId
    : normalized
  return { identityId, payloadProfileId }
}

export async function resolveSocialProfileIdentityId(profileIdValue: string): Promise<string> {
  return (await resolveSocialProfileIdentity(profileIdValue)).identityId
}

/** Backwards-compatible existence assertion for callers that only need validation. */
export async function assertSocialTargetUserExists(targetUserId: string): Promise<void> {
  await resolveSocialProfileIdentityId(targetUserId)
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

  return relayW05Response(response, responseHeaders)
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
  headers.set('X-LuckRead-Principal-Verified', input.principal.verified === true ? 'true' : 'false')
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

  return relayW05Response(response, responseHeaders)
}