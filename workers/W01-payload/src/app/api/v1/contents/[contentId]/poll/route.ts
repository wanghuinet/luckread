import { enforcePublicReadRateLimit, TrafficLimitError, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import { callW05Social, callW05SocialPublic, resolveCookieSocialPrincipal, resolveOptionalCookieSocialPrincipal, W05SocialClientError } from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

const resolveContentId = async (context: { params: Promise<{ contentId: string }> }) => {
  const { contentId } = await context.params
  return contentId.trim()
}

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const contentId = await resolveContentId(context)
    if (!contentId) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const viewer = await resolveOptionalCookieSocialPrincipal(request)
    if (viewer instanceof Response) return viewer
    if (!viewer) await enforcePublicReadRateLimit(request)
    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/poll',
      method: 'GET',
      principal: viewer,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social poll service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const contentId = await resolveContentId(context)
    if (!contentId) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll request') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll request')
    const raw = body as Record<string, unknown>
    const hasDurationMinutes = Object.prototype.hasOwnProperty.call(raw, 'durationMinutes')
    const hasLegacyDurationHours = Object.prototype.hasOwnProperty.call(raw, 'durationHours')
    if (
      !Array.isArray(raw.options) ||
      (hasDurationMinutes && hasLegacyDurationHours) ||
      (hasDurationMinutes && (typeof raw.durationMinutes !== 'number' || !Number.isSafeInteger(raw.durationMinutes) || raw.durationMinutes < 5 || raw.durationMinutes > 10080)) ||
      (hasLegacyDurationHours && (typeof raw.durationHours !== 'number' || ![24, 72, 168].includes(raw.durationHours)))
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll options or duration')
    }
    const durationMinutes = hasDurationMinutes
      ? raw.durationMinutes
      : hasLegacyDurationHours
        ? Number(raw.durationHours) * 60
        : 1440
    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/poll',
      method: 'POST',
      principal,
      body: { options: raw.options, durationMinutes },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social poll service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const contentId = await resolveContentId(context)
    if (!contentId) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/poll',
      method: 'DELETE',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social poll service unavailable')
  }
}
