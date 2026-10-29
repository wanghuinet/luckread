import { getCloudflareContext } from '@opennextjs/cloudflare'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../auth/traffic-limit.js'
import { getBetterAuthPrincipal, W02AuthClientError } from '../auth/w02-session-client.js'
import { callW08Creator, W08CreatorClientError } from '../auth/w08-creator-client.js'

type W03ContentService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type ContentPrincipal = {
  userId: string
  layer: string | null
  /** Derived from W02's authoritative verified_user role assignment. */
  verified?: boolean
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
    return {
      userId: principal.userId,
      layer: principal.layer ?? null,
      verified: principal.roleAssignments?.some((assignment) => assignment.roleId === 'verified_user') === true,
    }
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

/**
 * Resolve the authenticated caller's canonical W08 creator identity. The value
 * is server-derived through W08 and must never be copied from a client payload.
 */
export async function resolveVerifiedContentCreatorId(
  request: Request,
  principal: ContentPrincipal,
): Promise<string | Response> {
  if (!principal.layer || !/^L[34]$/.test(principal.layer)) {
    return errorResponse(403, 'PERMISSION_DENIED', 'Creator permission required')
  }
  try {
    const response = await callW08Creator(request, '/internal/creator/self', 'GET')
    if (response.status === 404) {
      return errorResponse(403, 'PERMISSION_DENIED', 'An active creator identity is required')
    }
    if (!response.ok) {
      return errorResponse(503, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator identity service unavailable')
    }
    const envelope: unknown = await response.json().catch((): null => null)
    const creatorId = envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      ? (envelope as { data?: { creatorId?: unknown } }).data?.creatorId
      : undefined
    if (typeof creatorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(creatorId)) {
      return errorResponse(503, 'CREATOR_IDENTITY_UNAVAILABLE', 'Creator identity could not be verified')
    }
    return creatorId
  } catch (error) {
    const status = error instanceof W08CreatorClientError ? error.status : 503
    return errorResponse(status, 'CREATOR_SERVICE_UNAVAILABLE', 'Creator identity service unavailable')
  }
}

export async function callW03Content(input: {
  request: Request
  pathname: string
  method: string
  body?: unknown
  principal?: ContentPrincipal | null
  verifiedCreatorId?: string
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
  if (input.principal) {
    headers.set('X-LuckRead-Principal-Verified', input.principal.verified === true ? 'true' : 'false')
  }
  if (input.verifiedCreatorId !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(input.verifiedCreatorId)) {
      throw new W03ContentClientError(403, 'PERMISSION_DENIED', 'Creator identity is invalid')
    }
    headers.set('X-LuckRead-Verified-Creator-Id', input.verifiedCreatorId)
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
