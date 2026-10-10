import { listSessions, revokeSessionById, W02AuthClientError } from '../../../../auth/w02-session-client.js'
import { enforcePublicReadRateLimit, enforceW01WriteRateLimit, rateLimitResponse, TrafficLimitError } from '../../../../auth/traffic-limit.js'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const mapError = (error: unknown): Response => {
  if (error instanceof W02AuthClientError) {
    if (error.status === 401) return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    if (error.status === 403) return json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied' } }, 403)
    if (error.status === 400) return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session request' } }, 400)
    if (error.status === 429) {
      return new Response(JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          details: { retryAfter: 60 },
        },
      }), {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': '60',
        },
      })
    }
  }
  return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  const url = new URL(request.url)
  const rawLimit = url.searchParams.get('limit')
  const requestedLimit = rawLimit === null ? 20 : Number(rawLimit)
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session list limit' } }, 400)
  }

  const cursor = url.searchParams.get('cursor')
  if (cursor !== null && (!cursor || cursor.length > 256)) {
    return json({ error: { code: 'INVALID_CURSOR', message: 'Invalid session list cursor' } }, 400)
  }

  try {
    await enforcePublicReadRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
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
  if (segments.length !== 1 || !segments[0]) return new Response(null, { status: 404 })

  try {
    await enforceW01WriteRateLimit(request)
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
  }

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
