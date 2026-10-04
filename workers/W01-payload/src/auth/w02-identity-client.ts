import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02ErrorPayload = {
  error?: {
    code?: string
  }
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
  if (!service) throw new W02AuthClientError(503, 'W02 identity service is unavailable')
  return service
}

async function callW02<T>(path: string, body: unknown): Promise<T> {
  const service = await getW02Service()
  const response = await service.fetch(
    new Request('https://luckread-w02.internal' + path, {
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

    if (code === 'UNAUTHENTICATED') throw new W02AuthClientError(401, 'authentication denied')
    if (code === 'VALIDATION_FAILED' || code === 'INVALID_CURSOR') throw new W02AuthClientError(400, 'invalid identity request')
    if (code === 'PERMISSION_DENIED') throw new W02AuthClientError(403, 'permission denied')
    if (code === 'NOT_FOUND') throw new W02AuthClientError(404, 'resource not found')
    if (code === 'INVALID_STATE') throw new W02AuthClientError(409, 'invalid state')
    if (code === 'PRECONDITION_FAILED') throw new W02AuthClientError(412, 'precondition failed')
    throw new W02AuthClientError(503, 'identity service unavailable')
  }

  if (!payload || typeof payload !== 'object') {
    throw new W02AuthClientError(503, 'invalid identity service response')
  }

  return payload as T
}

export async function resolveGlobalLayer(body: {
  subjectId: string
  accountState: string
  now?: string
}): Promise<{ decision: 'ALLOW' | 'DENY'; layer?: string }> {
  return callW02('/internal/authz/resolve-layer', body)
}

export type AccountStateTransitionResult = {
  from: string
  to: string
  auditEventId: string
}

export function transitionAccountState(body: {
  subjectId: string
  targetUserId: string
  to: string
  reason: string
  expectedVersion: number
}) {
  return callW02<AccountStateTransitionResult>('/internal/account/transition', body)
}
