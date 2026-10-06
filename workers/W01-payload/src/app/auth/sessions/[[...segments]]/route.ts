import { proxyBetterAuth, revokeSessionById, W02AuthClientError } from '../../../../auth/w02-session-client.js'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const mapError = (error: unknown): Response => {
  if (error instanceof W02AuthClientError) {
    if (error.status === 401) return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    if (error.status === 403) return json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied' } }, 403)
    if (error.status === 400) return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session request' } }, 400)
  }
  return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  try {
    const response = await proxyBetterAuth(request, '/list-sessions', { method: 'GET' })
    if (!response.ok) return response

    const sessions = await response.json() as Array<Record<string, unknown>>
    return json({
      items: sessions.map((session) => ({
        sessionId: String(session.id ?? ''),
        deviceId: null as string | null,
        createdAt: String(session.createdAt ?? ''),
        expiresAt: String(session.expiresAt ?? ''),
        lastSeenAt: null as string | null,
      })),
      nextCursor: null,
    })
  } catch (error) {
    return mapError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 1 || !segments[0]) return new Response(null, { status: 404 })

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required' } }, 400)
  }

  try {
    await revokeSessionById(request, segments[0])
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return mapError(error)
  }
}
