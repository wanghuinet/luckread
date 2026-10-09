import { cachedPublicGet, rememberPublicShareContentId } from '../../../../../lib/public-response-cache.js'
import { TrafficLimitError, enforcePublicReadRateLimit, rateLimitResponse } from '../../../../../auth/traffic-limit.js'
import { hasAuthenticatedSessionCredential } from '../../../../../lib/content-list-cache-guard.js'

import {
  callW05SocialPublic,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ shareId: string }> },
): Promise<Response> {
  try {
    const { shareId } = await context.params
    if (!shareId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid share id')
    await enforcePublicReadRateLimit(request)
    if (hasAuthenticatedSessionCredential(request)) {
      return await callW05SocialPublic({
        request,
        pathname: '/internal/social/shares/' + encodeURIComponent(shareId),
        method: 'GET',
      })
    }

    return await cachedPublicGet(
      request,
      'share-detail',
      async () => {
        const response = await callW05SocialPublic({
          request,
          pathname: '/internal/social/shares/' + encodeURIComponent(shareId),
          method: 'GET',
        })
        if (response.ok) {
          try {
            const payload = await response.clone().json() as {
              data?: { shareId?: unknown; contentId?: unknown }
            }
            if (typeof payload.data?.shareId === 'string' && typeof payload.data?.contentId === 'string') {
              await rememberPublicShareContentId(payload.data.shareId, payload.data.contentId)
            }
          } catch {
            // Cache metadata is best-effort; share resolution remains authoritative.
          }
        }
        return response
      },
      60,
    )
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
