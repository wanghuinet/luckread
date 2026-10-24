import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02ErrorPayload = {
  error?: { code?: string }
}

export class W02AuthClientError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
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
  options: { request: Request; method?: string; body?: unknown; headers?: HeadersInit } ,
): Promise<Response> {
  const service = await getW02Service()
  const headers = forwardedHeaders(options.request.headers)
  new Headers(options.headers).forEach((value, key) => headers.set(key, value))
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
  roleAssignments?: Array<{
    id: string
    roleId: string
    scopeType: 'global' | 'organization' | 'ip'
    scopeId: string | null
  }>
}

export type MfaStatusResponse = {
  enabled: boolean
  verified: boolean
  enrolledAt: string | null
}

/**
 * Read the authenticated user's MFA projection through the W01 -> W02 binding.
 * The caller marker is added by this server-side adapter; clients cannot
 * select or override the target user ID.
 */
export async function getMfaStatus(request: Request): Promise<MfaStatusResponse> {
  const response = await callW02('/internal/auth/mfa/status', {
    request,
    headers: {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
    },
  })

  let payload: unknown = null
  try { payload = await response.json() } catch {}
  const data = payload && typeof payload === 'object'
    ? (payload as { data?: unknown }).data
    : null
  if (
    response.ok &&
    data && typeof data === 'object' &&
    typeof (data as MfaStatusResponse).enabled === 'boolean' &&
    typeof (data as MfaStatusResponse).verified === 'boolean' &&
    ((data as MfaStatusResponse).enrolledAt === null ||
      (typeof (data as MfaStatusResponse).enrolledAt === 'string' &&
        Number.isFinite(Date.parse((data as MfaStatusResponse).enrolledAt as string))))
  ) {
    const value = data as MfaStatusResponse
    return {
      enabled: value.enabled,
      verified: value.verified,
      enrolledAt: value.enrolledAt,
    }
  }

  throw new W02AuthClientError(response.status || 503, 'MFA status failed', errorCode(payload) ?? undefined)
}

const readSetCookieHeaders = (headers: Headers): string[] => {
  const enhanced = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof enhanced.getSetCookie === 'function') {
    return enhanced.getSetCookie.call(headers).filter((value) => value.length > 0)
  }
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

export type ConfirmMfaEnrollmentResult = {
  status: MfaStatusResponse
  setCookieHeaders: string[]
}

export async function confirmMfaEnrollment(
  request: Request,
  code: string,
  idempotencyKey: string,
): Promise<ConfirmMfaEnrollmentResult> {
  const response = await callW02('/internal/auth/mfa/enrollment/confirm', {
    request,
    body: { code },
    headers: {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'Idempotency-Key': idempotencyKey,
    },
  })
  let payload: unknown = null
  try { payload = await response.json() } catch {}
  const data = payload && typeof payload === 'object'
    ? (payload as { data?: unknown }).data
    : null
  if (
    response.ok &&
    data && typeof data === 'object' &&
    typeof (data as MfaStatusResponse).enabled === 'boolean' &&
    typeof (data as MfaStatusResponse).verified === 'boolean' &&
    typeof (data as MfaStatusResponse).enrolledAt === 'string' &&
    Number.isFinite(Date.parse((data as MfaStatusResponse).enrolledAt as string))
  ) {
    const status = data as MfaStatusResponse
    if (status.enabled && status.verified) {
      return {
        status: {
          enabled: true,
          verified: true,
          enrolledAt: new Date(status.enrolledAt as string).toISOString(),
        },
        // These cookies are forwarded only after W02 validates the response DTO.
        // The Better Auth JSON body (which contains its raw token) is never exposed.
        setCookieHeaders: readSetCookieHeaders(response.headers),
      }
    }
  }
  throw new W02AuthClientError(response.status || 503, 'MFA enrollment confirmation failed', errorCode(payload) ?? undefined)
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

export type SessionListResponse = {
  items: Array<{
    sessionId: string
    deviceId?: string
    createdAt: string
    expiresAt: string
    lastSeenAt: string | null
  }>
  currentSessionId: string
  nextCursor: string | null
}

export async function listSessions(
  request: Request,
  input: { limit: number; cursor?: string },
): Promise<SessionListResponse> {
  const response = await callW02('/internal/auth/session/list', {
    request,
    body: input,
  })

  let payload: unknown = null
  try { payload = await response.json() } catch {}

  if (
    response.ok &&
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as SessionListResponse).items) &&
    typeof (payload as SessionListResponse).currentSessionId === 'string' &&
    ((payload as SessionListResponse).nextCursor === null ||
      typeof (payload as SessionListResponse).nextCursor === 'string')
  ) {
    return payload as SessionListResponse
  }

  throw new W02AuthClientError(response.status || 503, 'session list failed', errorCode(payload) ?? undefined)
}

export async function revokeSessionById(request: Request, sessionId: string): Promise<void> {
  const response = await callW02('/internal/auth/session/revoke-by-id', {
    request,
    body: { sessionId },
  })
  if (!response.ok) throw new W02AuthClientError(response.status, 'session revoke failed')
}

export async function rollbackRegistrationUser(
  request: Request,
  body: { userId: string; email: string; username: string },
): Promise<void> {
  const response = await callW02('/internal/auth/registration/rollback', { request, body })
  if (!response.ok) throw new W02AuthClientError(response.status, 'registration rollback failed')
}
