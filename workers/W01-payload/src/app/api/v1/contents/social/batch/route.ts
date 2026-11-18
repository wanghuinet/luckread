import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import {
  callW05SocialPublic,
  resolveOptionalCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const validContentId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export async function POST(request: Request): Promise<Response> {
  try {
    const viewer = await resolveOptionalCookieSocialPrincipal(request)
    if (viewer instanceof Response) return viewer

    const rawBody = await request.text()
    if (rawBody.length > 8192) return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Social batch is too large')
    let value: unknown
    try { value = JSON.parse(rawBody) } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid social batch request')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid social batch request')
    }
    const rawIds = (value as { contentIds?: unknown }).contentIds
    if (
      !Array.isArray(rawIds) ||
      rawIds.length < 1 ||
      rawIds.length > 50 ||
      rawIds.some(id => typeof id !== 'string' || !validContentId.test(id.trim()))
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content IDs')
    }
    const contentIds = [...new Set(rawIds.map(id => (id as string).trim()))]
    if (!viewer) await enforcePublicReadRateLimit(request)
    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/contents/summary-batch',
      method: 'POST',
      principal: viewer,
      body: { contentIds },
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
