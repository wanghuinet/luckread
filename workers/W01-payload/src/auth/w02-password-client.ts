import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

type W02PasswordError = {
  error?: {
    code?: string
  }
}

export class W02PasswordClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) {
    throw new W02PasswordClientError(
      503,
      'SERVICE_UNAVAILABLE',
      'W02 authentication service is unavailable',
    )
  }
  return service
}

export async function changePasswordThroughW02(
  request: Request,
  body: { currentPassword: string; newPassword: string },
): Promise<Response> {
  const service = await getW02Service()
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('X-LuckRead-Caller', 'W01')
  headers.set('content-type', 'application/json; charset=utf-8')

  let response: Response
  try {
    response = await service.fetch(
      new Request('https://luckread-w02.internal/internal/auth/password/change', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  } catch {
    throw new W02PasswordClientError(
      503,
      'SERVICE_UNAVAILABLE',
      'W02 authentication service is unavailable',
    )
  }

  if (response.ok) return response

  let payload: W02PasswordError | null = null
  try {
    payload = await response.json() as W02PasswordError
  } catch {
    payload = null
  }

  const code = payload?.error?.code ?? 'SERVICE_UNAVAILABLE'
  if (response.status === 400 && code === 'VALIDATION_FAILED') {
    throw new W02PasswordClientError(
      400,
      code,
      'Invalid password change request',
    )
  }
  if (response.status === 401 && code === 'UNAUTHENTICATED') {
    throw new W02PasswordClientError(
      401,
      code,
      'Authentication denied',
    )
  }

  throw new W02PasswordClientError(
    503,
    'SERVICE_UNAVAILABLE',
    'Password change service unavailable',
  )
}
