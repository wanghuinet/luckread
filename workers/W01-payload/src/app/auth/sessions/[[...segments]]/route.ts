import {
  getBetterAuthSession,
  listBetterAuthSessions,
  revokeBetterAuthSession,
} from '../../../../auth/better-auth'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    status,
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  const session = await getBetterAuthSession(request).catch((): null => null)
  if (!session?.user?.id) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')

  try {
    const sessions = await listBetterAuthSessions(request)
    return json({
      items: sessions.map((item) => ({
        sessionId: String(item.id),
        deviceId: item.userAgent ?? item.ipAddress ?? null,
        createdAt: new Date(item.createdAt).toISOString(),
        expiresAt: new Date(item.expiresAt).toISOString(),
        lastSeenAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
      })),
      nextCursor: null,
      currentSessionId: String(session.session.id),
    })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 1 || !segments[0]) return new Response(null, { status: 404 })

  if (!request.headers.get('Idempotency-Key')?.trim()) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  const session = await getBetterAuthSession(request).catch((): null => null)
  if (!session?.user?.id) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')

  try {
    const sessions = await listBetterAuthSessions(request)
    const target = sessions.find((item) => String(item.id) === segments[0])

    // Better Auth session revocation is idempotent from the public W01
    // boundary: a missing/already-expired target is a successful no-op.
    if (!target) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

    await revokeBetterAuthSession(request, target.token)
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
  }
}
