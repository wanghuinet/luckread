import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02ErrorPayload = {
  error?: {
    code?: string
    message?: string
  }
}

export type BetterAuthPrincipal = {
  userId: string
  email: string
  username?: string
  sessionId: string
  accountState: string
  accountStateVersion: number
  layer: string
}

export class W02AuthClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) throw new W02AuthClientError(503, 'W02 authentication service is unavailable')
  return service
}

export async function callW02BetterAuth(
  request: Request,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const service = await getW02Service()
  const headers = new Headers(request.headers)
  if (init.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')
  const response = await service.fetch(
    new Request(`https://luckread-w02.internal${path}`, {
      method: init.method ?? request.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  )
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function callInternal<T>(
  request: Request,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await callW02BetterAuth(request, path, { method: 'POST', body })
  let payload: T | W02ErrorPayload | null = null
  try { payload = await response.json() as T | W02ErrorPayload } catch { payload = null }

  if (!response.ok) {
    const code = payload && typeof payload === 'object' && payload !== null && 'error' in payload
      ? (payload as W02ErrorPayload).error?.code
      : undefined
    throw new W02AuthClientError(
      response.status,
      typeof code === 'string' ? code : 'SERVICE_UNAVAILABLE',
    )
  }
  if (!payload || typeof payload !== 'object') {
    throw new W02AuthClientError(503, 'invalid W02 authentication response')
  }
  return payload as T
}

export async function resolveBetterAuthPrincipal(
  request: Request,
): Promise<BetterAuthPrincipal> {
  return callInternal<BetterAuthPrincipal>(request, '/internal/auth/principal', {})
}

export type SessionListResult = {
  items: Array<{
    sessionId: string
    deviceId: string | null
    createdAt: string
    expiresAt: string
    lastSeenAt: string | null
  }>
  nextCursor: string | null
  currentSessionId: string
}

export async function listSessions(
  request: Request,
  input: { cursor?: string; limit?: number } = {},
): Promise<SessionListResult> {
  const params = new URLSearchParams()
  if (input.cursor) params.set('cursor', input.cursor)
  if (input.limit !== undefined) params.set('limit', String(input.limit))
  const path = '/internal/auth/session/list' + (params.toString() ? '?' + params.toString() : '')
  return callInternal<SessionListResult>(request, path, {})
}

export async function revokeOwnedSession(
  request: Request,
  targetSessionId: string,
): Promise<{ revoked: boolean }> {
  return callInternal<{ revoked: boolean }>(
    request,
    '/internal/auth/session/revoke-owned',
    { targetSessionId },
  )
}

export type AccountStateTransitionResult = {
  from: string
  to: string
  auditEventId: string
}

export const transitionAccountState = (request: Request, body: {
  subjectId: string
  targetUserId: string
  to: string
  reason: string
  expectedVersion: number
}) =>
  callInternal<AccountStateTransitionResult>(
    request,
    '/internal/account/transition',
    body,
  )
