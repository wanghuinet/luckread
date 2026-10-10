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

    const rawSessions = await response.json() as unknown
    if (!Array.isArray(rawSessions)) {
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
    }

    const currentResponse = await proxyBetterAuth(request, '/get-session', { method: 'GET' })
    if (!currentResponse.ok) return currentResponse
    const currentPayload = await currentResponse.json() as { session?: { id?: unknown } }
    const currentSessionId = typeof currentPayload?.session?.id === 'string'
      ? currentPayload.session.id
      : ''
    // Fail closed: without the active session ID the client cannot safely
    // distinguish its current session from sessions that may be revoked.
    if (!currentSessionId) {
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Current session could not be resolved' } }, 503)
    }

    const url = new URL(request.url)
    const rawLimit = url.searchParams.get('limit')
    const requestedLimit = rawLimit === null ? 20 : Number(rawLimit)
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session list limit' } }, 400)
    }
    const cursor = url.searchParams.get('cursor')
    if (cursor !== null && (cursor.length === 0 || cursor.length > 128)) {
      return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
    }

    const sessions = (rawSessions as Array<Record<string, unknown>>)
      .filter((session) => typeof session.id === 'string' && session.id.length > 0)
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.createdAt ?? ''))
        const rightTime = Date.parse(String(right.createdAt ?? ''))
        const timeOrder = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
        return timeOrder || String(right.id).localeCompare(String(left.id))
      })

    const cursorIndex = cursor === null ? -1 : sessions.findIndex((session) => session.id === cursor)
    if (cursor !== null && cursorIndex < 0) {
      return json({ error: { code: 'INVALID_CURSOR', message: 'Session list cursor is no longer valid' } }, 400)
    }
    const startIndex = cursor === null ? 0 : cursorIndex + 1
    const pageLimit = Math.min(50, requestedLimit)
    const page = sessions.slice(startIndex, startIndex + pageLimit)
    const hasMore = startIndex + page.length < sessions.length

    return json({
      items: page.map((session) => ({
        sessionId: String(session.id),
        ...(typeof session.deviceId === 'string' ? { deviceId: session.deviceId } : {}),
        createdAt: String(session.createdAt ?? ''),
        expiresAt: String(session.expiresAt ?? ''),
        lastSeenAt: typeof session.lastSeenAt === 'string' ? session.lastSeenAt : null,
      })),
      currentSessionId,
      nextCursor: hasMore && page.length > 0 ? String(page[page.length - 1].id) : null,
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
