import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import { readVerifiedPayloadTokenVersion } from '../auth/payload-access-token.js'
import { resolveAuthenticatedPrincipal, W02AuthClientError } from '../auth/w02-session-client.js'

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
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
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

const getPayloadCookieToken = (request: Request): string | null => {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const cookieName = 'payload-token'
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    if (rawName !== cookieName || rawValue.length === 0) continue
    try {
      return decodeURIComponent(rawValue.join('='))
    } catch {
      return rawValue.join('=')
    }
  }
  return null
}

export async function resolveContentPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const payload = await getPayload({ config })

  let authResult: Awaited<ReturnType<typeof payload.auth>>
  try {
    authResult = await payload.auth({
      headers: new Headers({ Authorization: authorization }),
      canSetHeaders: false,
    })
  } catch {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication failed')
  }

  const user = authResult.user as ({ id?: unknown; _sid?: unknown } | null)
  if (!user?.id || typeof user._sid !== 'string') {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (tokenVersion === null) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  try {
    const session = await resolveAuthenticatedPrincipal({
      sessionId: user._sid,
      userId: String(user.id),
      tokenVersion,
    })
    if (!session.active) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    return { userId: String(user.id), layer: session.layer ?? null }
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}

export async function resolveCookieContentPrincipal(request: Request): Promise<ContentPrincipal | Response> {
  const authorization = request.headers.get('Authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    return resolveContentPrincipal(request)
  }

  const token = getPayloadCookieToken(request)
  if (!token) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return resolveContentPrincipal(
    new Request(request.url, {
      method: 'GET',
      headers,
    }),
  )
}

export async function resolveOptionalContentPrincipal(
  request: Request,
): Promise<ContentPrincipal | Response | null> {
  if (!request.headers.get('Authorization')) return null
  return resolveContentPrincipal(request)
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
