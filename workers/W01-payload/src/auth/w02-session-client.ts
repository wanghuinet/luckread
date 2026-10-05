import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02ErrorPayload = {
  error?: {
    code?: string
  }
}

export type EstablishSessionResult = {
  sessionId: string
  refreshToken: string
  tokenVersion: number
  layer: string
  nativeExpiresAt: string
}

export type RefreshSessionResult = {
  sessionId: string
  userId: string
  refreshToken: string
  tokenVersion: number
  layer: string
  nativeExpiresAt: string
  email: string
}

export class W02AuthClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) {
    throw new W02AuthClientError(503, 'W02 authentication service is unavailable')
  }
  return service
}

async function callW02<T>(path: string, body: unknown): Promise<T> {
  const service = await getW02Service()
  const response = await service.fetch(
    new Request(`https://luckread-w02.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

  let payload: T | W02ErrorPayload | null = null
  try {
    payload = (await response.json()) as T | W02ErrorPayload
  } catch {
    payload = null
  }

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as W02ErrorPayload).error?.code === 'string'
        ? (payload as W02ErrorPayload).error!.code!
        : 'SERVICE_UNAVAILABLE'

    if (response.status === 422) {
      throw new W02AuthClientError(422, 'validation failed', code)
    }
    if (response.status === 409) {
      throw new W02AuthClientError(409, 'request conflicts with an in-progress operation', code)
    }
    if (code === 'UNAUTHENTICATED') {
      throw new W02AuthClientError(401, 'authentication denied')
    }
    if (code === 'VALIDATION_FAILED' || code === 'INVALID_CURSOR') {
      throw new W02AuthClientError(400, 'invalid authentication request')
    }
    if (code === 'PERMISSION_DENIED') {
      throw new W02AuthClientError(403, 'permission denied')
    }
    if (code === 'NOT_FOUND') {
      throw new W02AuthClientError(404, 'resource not found')
    }
    if (code === 'INVALID_STATE') {
      throw new W02AuthClientError(409, 'invalid state')
    }
    if (code === 'PRECONDITION_FAILED') {
      throw new W02AuthClientError(412, 'precondition failed')
    }

    throw new W02AuthClientError(503, 'authentication service unavailable')
  }

  if (!payload || typeof payload !== 'object') {
    throw new W02AuthClientError(503, 'invalid authentication service response')
  }

  return payload as T
}

export type BetterAuthRegistrationResult = {
  userId: string
  accountState: string
}

export const registerWithBetterAuth = (body: {
  identityType: 'email'
  identity: string
  credential: string
  username: string
  consent: {
    purpose: string
    policyVersion: string
  }
  idempotencyKey: string
}) => callW02<BetterAuthRegistrationResult>('/internal/auth/register', body)

export type BetterAuthSignInResult = {
  token: string
  user: {
    id: string
    email: string
  }
  setCookie: string | null
}

export type BetterAuthPrincipalResult = {
  active: boolean
  userId: string
  email: string
  sessionId: string
  accountState: string
  accountStateVersion: number
  layer: string
  tokenVersion?: number
}

export async function signInWithBetterAuth(body: {
  email: string
  password: string
}): Promise<BetterAuthSignInResult> {
  const service = await getW02Service()
  const response = await service.fetch(
    new Request('https://luckread-w02.internal/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: body.email,
        password: body.password,
        rememberMe: true,
      }),
    }),
  )

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new W02AuthClientError(401, 'authentication denied')
    }
    if (response.status === 400) {
      throw new W02AuthClientError(400, 'invalid authentication request')
    }
    throw new W02AuthClientError(503, 'authentication service unavailable')
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as { token?: unknown }).token !== 'string' ||
    typeof (payload as { user?: { id?: unknown; email?: unknown } }).user?.id !== 'string' ||
    typeof (payload as { user?: { id?: unknown; email?: unknown } }).user?.email !== 'string'
  ) {
    throw new W02AuthClientError(503, 'invalid authentication service response')
  }

  return {
    token: (payload as { token: string }).token,
    user: {
      id: (payload as { user: { id: string } }).user.id,
      email: (payload as { user: { email: string } }).user.email,
    },
    setCookie: response.headers.get('set-cookie'),
  }
}

export async function resolveBetterAuthPrincipal(token: string): Promise<BetterAuthPrincipalResult> {
  if (typeof token !== 'string' || token.length < 1) {
    throw new W02AuthClientError(401, 'authentication denied')
  }

  const service = await getW02Service()
  const response = await service.fetch(
    new Request('https://luckread-w02.internal/internal/auth/principal', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  )

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new W02AuthClientError(401, 'authentication denied')
    }
    if (response.status === 400) {
      throw new W02AuthClientError(400, 'invalid authentication request')
    }
    throw new W02AuthClientError(503, 'authentication service unavailable')
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as { active?: unknown }).active !== true ||
    typeof (payload as { userId?: unknown }).userId !== 'string' ||
    typeof (payload as { email?: unknown }).email !== 'string' ||
    typeof (payload as { sessionId?: unknown }).sessionId !== 'string' ||
    typeof (payload as { accountState?: unknown }).accountState !== 'string' ||
    typeof (payload as { accountStateVersion?: unknown }).accountStateVersion !== 'number' ||
    typeof (payload as { layer?: unknown }).layer !== 'string'
  ) {
    throw new W02AuthClientError(401, 'authentication denied')
  }

  return payload as BetterAuthPrincipalResult
}

export async function resolveBetterAuthPrincipalThroughW02(
  request: Request,
): Promise<BetterAuthPrincipalResult> {
  const service = await getW02Service()
  const headers = new Headers()
  const cookie = request.headers.get('cookie')
  const authorization = request.headers.get('authorization')
  if (cookie) {
    headers.set('cookie', cookie)
  } else if (authorization) {
    headers.set('authorization', authorization)
  }
  for (const name of ['origin', 'referer', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('content-type', 'application/json')
  headers.set('X-LuckRead-Caller', 'W01')

  let response: Response
  try {
    response = await service.fetch(
      new Request('https://luckread-w02.internal/internal/auth/principal', {
        method: 'POST',
        headers,
        body: '{}',
      }),
    )
  } catch {
    throw new W02AuthClientError(503, 'W02 authentication service is unavailable')
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.status === 401) {
    throw new W02AuthClientError(401, 'authentication denied')
  }
  if (!response.ok) {
    throw new W02AuthClientError(503, 'authentication service unavailable')
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as { active?: unknown }).active !== true ||
    typeof (payload as { userId?: unknown }).userId !== 'string' ||
    typeof (payload as { email?: unknown }).email !== 'string' ||
    typeof (payload as { sessionId?: unknown }).sessionId !== 'string' ||
    typeof (payload as { accountState?: unknown }).accountState !== 'string' ||
    typeof (payload as { accountStateVersion?: unknown }).accountStateVersion !== 'number' ||
    typeof (payload as { layer?: unknown }).layer !== 'string' ||
    (
      (payload as { tokenVersion?: unknown }).tokenVersion !== undefined &&
      (
        typeof (payload as { tokenVersion?: unknown }).tokenVersion !== 'number' ||
        !Number.isSafeInteger((payload as { tokenVersion?: number }).tokenVersion) ||
        ((payload as { tokenVersion?: number }).tokenVersion ?? -1) < 0
      )
    )
  ) {
    throw new W02AuthClientError(503, 'invalid authentication service response')
  }

  return payload as BetterAuthPrincipalResult
}

export const establishSession = (body: {
  sessionId: string
  userId: string
  deviceId: string
  now?: string
}) => callW02<EstablishSessionResult>('/internal/auth/session/establish', body)

export const refreshSession = (body: {
  refreshToken: string
  deviceId: string
  now?: string
}) => callW02<RefreshSessionResult>('/internal/auth/session/refresh', body)


export const revokeSession = (body: { sessionId: string }) =>
  callW02<{ revoked: boolean }>('/internal/auth/session/revoke', body)

export const validateSession = async (body: {
  sessionId: string
  userId: string
  tokenVersion: number
}) => {
  const result = await callW02<{ active: boolean }>('/internal/auth/session/validate', body)
  return result.active
}

export const resolveAuthenticatedPrincipal = async (body: {
  sessionId: string
  userId: string
  tokenVersion: number
}) =>
  callW02<{ active: boolean; layer?: string }>('/internal/auth/session/principal', body)

export type AccountStateTransitionResult = {
  from: string
  to: string
  auditEventId: string
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
}

export type SessionPrincipal = {
  userId: string
  currentSessionId: string
  tokenVersion: number
}

export const listSessions = (body: SessionPrincipal & {
  cursor?: string
  limit?: number
}) => callW02<SessionListResult>('/internal/auth/session/list', body)

export const revokeOwnedSession = (body: SessionPrincipal & {
  targetSessionId: string
}) => callW02<{ revoked: boolean }>('/internal/auth/session/revoke-owned', body)

export const transitionAccountState = (body: {
  subjectId: string
  targetUserId: string
  to: string
  reason: string
  expectedVersion: number
}) => callW02<AccountStateTransitionResult>('/internal/account/transition', body)


export async function signOutThroughW02(request: Request): Promise<Response> {
  const service = await getW02Service()
  const headers = new Headers()
  const cookie = request.headers.get('cookie')
  const authorization = request.headers.get('authorization')
  if (cookie) {
    headers.set('cookie', cookie)
  } else if (authorization) {
    headers.set('authorization', authorization)
  }
  for (const name of ['origin', 'referer', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('content-type', 'application/json')
  headers.set('X-LuckRead-Caller', 'W01')

  try {
    return await service.fetch(
      new Request('https://luckread-w02.internal/api/auth/sign-out', {
        method: 'POST',
        headers,
        body: '{}',
      }),
    )
  } catch {
    throw new W02AuthClientError(503, 'W02 authentication service is unavailable')
  }
}
