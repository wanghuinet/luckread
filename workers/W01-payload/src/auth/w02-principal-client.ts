import { getCloudflareContext } from '@opennextjs/cloudflare'

export type CanonicalPrincipal = {
  userId: string
  email: string
  sessionId: string
  accountState: string
  accountStateVersion: number
  layer: string
}

export class W02PrincipalClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) throw new W02PrincipalClientError(503, 'W02 authentication service is unavailable')
  return service
}

export async function resolveCanonicalPrincipal(request: Request): Promise<CanonicalPrincipal | null> {
  const service = await getW02Service()
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')

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
    throw new W02PrincipalClientError(503, 'W02 authentication service is unavailable')
  }

  if (response.status === 401) return null
  if (!response.ok) {
    throw new W02PrincipalClientError(503, 'W02 authentication service is unavailable')
  }

  const payload = await response.json().catch((): null => null) as Partial<CanonicalPrincipal> | null
  if (
    !payload ||
    typeof payload.userId !== 'string' ||
    payload.userId.length === 0 ||
    typeof payload.sessionId !== 'string' ||
    payload.sessionId.length === 0 ||
    typeof payload.email !== 'string' ||
    payload.email.length === 0 ||
    typeof payload.accountState !== 'string' ||
    payload.accountState.length === 0 ||
    typeof payload.accountStateVersion !== 'number' ||
    !Number.isSafeInteger(payload.accountStateVersion) ||
    payload.accountStateVersion < 1 ||
    typeof payload.layer !== 'string' ||
    !/^L[0-8]$/.test(payload.layer)
  ) {
    throw new W02PrincipalClientError(503, 'Invalid W02 principal response')
  }

  return payload as CanonicalPrincipal
}
