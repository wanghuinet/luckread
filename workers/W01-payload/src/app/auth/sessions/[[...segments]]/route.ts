import { proxyBetterAuth, revokeSessionById, W02AuthClientError } from '../../../../auth/w02-session-client.js'
import { apiErrorResponse, normalizeApiErrorResponse } from '../../../../lib/api-response.js'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const mapError = (error: unknown): Response => {
  if (error instanceof W02AuthClientError) {
    return normalizeApiErrorResponse(
      new Response(null, { status: error.status }),
      'Session service unavailable',
    )
  }
  return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
}

const dateTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return apiErrorResponse(404, 'NOT_FOUND', 'Session route not found')

  try {
    const response = await proxyBetterAuth(request, '/list-sessions', { method: 'GET' })
    if (!response.ok) return normalizeApiErrorResponse(response, 'Session service unavailable')

    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) {
      return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service returned an invalid response')
    }

    const items = payload.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid session response')
      }
      const session = value as Record<string, unknown>
      const sessionId = typeof session.id === 'string' ? session.id.trim() : ''
      const createdAt = dateTime(session.createdAt)
      const expiresAt = dateTime(session.expiresAt)
      if (!sessionId || sessionId.length > 128 || !createdAt || !expiresAt) {
        throw new Error('Invalid session response')
      }

      const deviceId = typeof session.deviceId === 'string' &&
        session.deviceId.trim().length > 0 &&
        session.deviceId.length <= 128
        ? session.deviceId
        : undefined

      return {
        sessionId,
        ...(deviceId ? { deviceId } : {}),
        createdAt,
        expiresAt,
        lastSeenAt: dateTime(session.lastSeenAt),
      }
    })

    const currentResponse = await proxyBetterAuth(request, '/get-session', { method: 'GET' })
    if (!currentResponse.ok) {
      return normalizeApiErrorResponse(currentResponse, 'Session service unavailable')
    }
    const currentPayload: unknown = await currentResponse.json()
    const currentSessionId =
      currentPayload && typeof currentPayload === 'object' && !Array.isArray(currentPayload) &&
      'session' in currentPayload &&
      (currentPayload as { session?: { id?: unknown } | null }).session &&
      typeof (currentPayload as { session: { id?: unknown } }).session.id === 'string'
        ? (currentPayload as { session: { id: string } }).session.id
        : ''
    if (!currentSessionId || currentSessionId.length > 128) {
      return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Current session information is unavailable')
    }

    return json({ items, nextCursor: null, currentSessionId })
  } catch (error) {
    return mapError(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 1 || !segments[0]) {
    return apiErrorResponse(404, 'NOT_FOUND', 'Session not found')
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey) {
    return apiErrorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }
  if (idempotencyKey.length > 256) {
    return apiErrorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  }

  try {
    await revokeSessionById(request, segments[0])
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return mapError(error)
  }
}
