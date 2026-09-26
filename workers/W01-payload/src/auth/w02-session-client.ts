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

    if (code === 'UNAUTHENTICATED') {
      throw new W02AuthClientError(401, 'authentication denied')
    }
    if (code === 'VALIDATION_FAILED') {
      throw new W02AuthClientError(400, 'invalid authentication request')
    }

    throw new W02AuthClientError(503, 'authentication service unavailable')
  }

  if (!payload || typeof payload !== 'object') {
    throw new W02AuthClientError(503, 'invalid authentication service response')
  }

  return payload as T
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
