import { proxyBetterAuth } from '../../../../../auth/better-auth-route'

type PasswordResetRequest = {
  identifier?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let body: PasswordResetRequest
  try {
    body = (await request.json()) as PasswordResetRequest
  } catch {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid password recovery request' } },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    )
  }

  if (typeof body.identifier !== 'string' || body.identifier.trim().length === 0) {
    return Response.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Invalid password recovery request' } },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    )
  }

  return proxyBetterAuth(request, '/request-password-reset', 'POST', {
    email: body.identifier.trim().toLowerCase(),
    redirectTo: new URL('/reset-password', request.url).toString(),
  })
}
