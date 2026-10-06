import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02ErrorPayload = {
  error?: { code?: string }
}

export class W02AuthClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) throw new W02AuthClientError(503, 'W02 authentication service is unavailable')
  return service
}

const forwardedHeaders = (input: Headers): Headers => {
  const headers = new Headers(input)
  headers.delete('host')
  headers.delete('content-length')
  return headers
}

const errorCode = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const error = (value as W02ErrorPayload).error
  return error && typeof error.code === 'string' ? error.code : null
}

export async function callW02(
  path: string,
  options: { request: Request; method?: string; body?: unknown } ,
): Promise<Response> {
  const service = await getW02Service()
  const headers = forwardedHeaders(options.request.headers)
  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(options.body)
  }

  return service.fetch(
    new Request('https://luckread-w02.internal' + path, {
      method: options.method ?? 'POST',
      headers,
      body,
    }),
  )
}

export async function proxyBetterAuth(
  request: Request,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const response = await callW02('/api/auth' + path, {
    request,
    method: options.method ?? 'POST',
    body: options.body,
  })
  const headers = new Headers()
  response.headers.forEach((value, key) => headers.append(key, value))
  headers.set('cache-control', 'no-store')
  return new Response(await response.arrayBuffer(), { status: response.status, headers })
}

export type BetterAuthPrincipal = {
  active: boolean
  userId: string
  email: string
  username?: string
  accountState?: string
  accountStateVersion?: number
  sessionId?: string
  layer?: string
}

export async function getBetterAuthPrincipal(request: Request): Promise<BetterAuthPrincipal> {
  const response = await callW02('/internal/auth/principal', { request })
  let payload: unknown = null
  try { payload = await response.json() } catch {}

  if (
    response.ok &&
    payload &&
    typeof payload === 'object' &&
    (payload as BetterAuthPrincipal).active === true &&
    typeof (payload as BetterAuthPrincipal).userId === 'string' &&
    typeof (payload as BetterAuthPrincipal).email === 'string'
  ) {
    return payload as BetterAuthPrincipal
  }

  if (response.status === 401 || errorCode(payload) === 'UNAUTHENTICATED') {
    throw new W02AuthClientError(401, 'authentication denied')
  }
  throw new W02AuthClientError(503, 'authentication service unavailable')
}

export type AccountStateTransitionResult = {
  from: string
  to: string
  auditEventId: string
}

export async function transitionAccountState(
  request: Request,
  body: {
    subjectId: string
    targetUserId: string
    to: string
    reason: string
    expectedVersion: number
  },
): Promise<AccountStateTransitionResult> {
  const response = await callW02('/internal/account/transition', { request, body })
  let payload: unknown = null
  try { payload = await response.json() } catch {}
  if (response.ok && payload && typeof payload === 'object') {
    return payload as AccountStateTransitionResult
  }

  const code = errorCode(payload)
  const status =
    response.status === 401 || code === 'UNAUTHENTICATED' ? 401 :
    response.status === 403 || code === 'PERMISSION_DENIED' ? 403 :
    response.status === 404 || code === 'NOT_FOUND' ? 404 :
    response.status === 409 || code === 'INVALID_STATE' ? 409 :
    response.status === 412 || code === 'PRECONDITION_FAILED' ? 412 :
    response.status === 400 || code === 'VALIDATION_FAILED' ? 400 : 503

  throw new W02AuthClientError(status, 'account-state transition failed')
}

export async function revokeSessionById(request: Request, sessionId: string): Promise<void> {
  const response = await callW02('/internal/auth/session/revoke-by-id', {
    request,
    body: { sessionId },
  })
  if (!response.ok) throw new W02AuthClientError(response.status, 'session revoke failed')
}
