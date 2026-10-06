import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W02PasswordRecoveryClientError extends Error {
  constructor(
    readonly status: 422 | 503,
    readonly code: 'RECOVERY_TOKEN_REJECTED' | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) {
    throw new W02PasswordRecoveryClientError(
      503,
      'SERVICE_UNAVAILABLE',
      'W02 authentication service is unavailable',
    )
  }
  return service
}

const buildHeaders = (request: Request): Headers => {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'X-LuckRead-Caller': 'W01',
  })
  for (const name of ['origin', 'referer', 'user-agent']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export async function requestPasswordResetThroughW02(
  request: Request,
  email: string,
): Promise<void> {
  const service = await getW02Service()
  let response: Response

  try {
    response = await service.fetch(
      new Request('https://luckread-w02.internal/api/auth/request-password-reset', {
        method: 'POST',
        headers: buildHeaders(request),
        body: JSON.stringify({
          email,
          redirectTo: 'https://luckread.com/reset-password',
        }),
      }),
    )
  } catch {
    throw new W02PasswordRecoveryClientError(
      503,
      'SERVICE_UNAVAILABLE',
      'Password recovery service unavailable',
    )
  }

  if (response.ok) return

  throw new W02PasswordRecoveryClientError(
    503,
    'SERVICE_UNAVAILABLE',
    'Password recovery service unavailable',
  )
}

export async function resetPasswordThroughW02(
  request: Request,
  recoveryToken: string,
  newPassword: string,
): Promise<void> {
  const service = await getW02Service()
  let response: Response

  try {
    response = await service.fetch(
      new Request('https://luckread-w02.internal/api/auth/reset-password', {
        method: 'POST',
        headers: buildHeaders(request),
        body: JSON.stringify({
          newPassword,
          token: recoveryToken,
        }),
      }),
    )
  } catch {
    throw new W02PasswordRecoveryClientError(
      503,
      'SERVICE_UNAVAILABLE',
      'Password recovery service unavailable',
    )
  }

  if (response.ok) return

  if (response.status >= 400 && response.status < 500) {
    throw new W02PasswordRecoveryClientError(
      422,
      'RECOVERY_TOKEN_REJECTED',
      'Password reset token is invalid or expired',
    )
  }

  throw new W02PasswordRecoveryClientError(
    503,
    'SERVICE_UNAVAILABLE',
    'Password recovery service unavailable',
  )
}
