import { proxyBetterAuth } from '../../../../../auth/w02-session-client.js'

type PasswordResetRequest = { identifier?: unknown }

const jsonError = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export async function POST(request: Request): Promise<Response> {
  let body: PasswordResetRequest
  try { body = await request.json() as PasswordResetRequest } catch {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  if (typeof body.identifier !== 'string' || body.identifier.trim().length === 0) {
    return jsonError(422, 'VALIDATION_FAILED', 'Invalid password recovery request')
  }

  try {
    const response = await proxyBetterAuth(request, '/request-password-reset', {
      body: {
        email: body.identifier.trim().toLowerCase(),
        redirectTo: 'https://luckread.com/reset-password',
      },
    })
    if (response.ok) return new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } })
    return new Response(null, {
      status: response.status >= 500 ? 503 : response.status,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return jsonError(503, 'SERVICE_UNAVAILABLE', 'Password recovery service unavailable')
  }
}
