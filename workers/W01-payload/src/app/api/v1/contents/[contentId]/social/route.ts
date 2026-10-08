import { cachedPublicGet } from '../../../../../../lib/public-response-cache.js'
import { hasAuthenticatedSessionCredential } from '../../../../../../lib/content-list-cache-guard.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'
import {
  callW05Social,
  callW05SocialPublic,
  resolveCookieSocialPrincipal,
  resolveOptionalCookieSocialPrincipal,
  resolveSocialMentionTargets,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    if (!contentId.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const viewer = await resolveOptionalCookieSocialPrincipal(request)
    if (viewer instanceof Response) return viewer
    if (!viewer && !hasAuthenticatedSessionCredential(request)) {
      await enforcePublicReadRateLimit(request)
      return await cachedPublicGet(
        request,
        'content-social',
        () => callW05SocialPublic({
          request,
          pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/summary',
          method: 'GET',
        }),
        10,
      )
    }
    return await callW05SocialPublic({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/summary',
      method: 'GET',
      principal: viewer,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    if (!contentId.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    let value: unknown
    try { value = await request.json() } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid social metadata request')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid social metadata request')
    }

    const text = (value as { text?: unknown }).text
    if (typeof text !== 'string' || text.length > 10000) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid social metadata text')
    }

    const mentions = await resolveSocialMentionTargets(text)
    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/tokens',
      method: 'POST',
      principal,
      body: { text, mentions },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
