import { listSessions, revokeSessionById, W02AuthClientError } from '../../../../auth/w02-session-client.js'
import { enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse, TrafficLimitError } from '../../../../auth/traffic-limit.js'
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

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) {
    return apiErrorResponse(404, 'NOT_FOUND', 'Session route not found')
  }

  const url = new URL(request.url)
  const rawLimit = url.searchParams.get('limit')
  const requestedLimit = rawLimit === null ? 20 : Number(rawLimit)
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return apiErrorResponse(400, 'VALIDATION_FAILED', 'Invalid session list limit')
  }

  const cursor = url.searchParams.get('cursor')
  if (cursor !== null && (!cursor || cursor.length > 256)) {
    return apiErrorResponse(400, 'INVALID_CURSOR', 'Invalid session list cursor')
  }

  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
  }

  try {
    // W02 applies authenticated self-scope and a bounded D1 query; W01 caps
    // the public contract to 50 items even when a client asks for 100.
    const result = await listSessions(request, {
      limit: Math.min(50, requestedLimit),
      ...(cursor === null ? {} : { cursor }),
    })
    return json(result)
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

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return apiErrorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
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
