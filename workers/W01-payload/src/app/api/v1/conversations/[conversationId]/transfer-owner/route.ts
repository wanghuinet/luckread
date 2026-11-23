import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

type RouteContext = { params: Promise<{ conversationId: string }> }

/**
 * Transfer group ownership through the W01 -> W05 boundary.
 * W01 resolves public profile IDs to canonical identity IDs before W05
 * applies the owner-only transactional membership change.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const { conversationId } = await context.params
    if (!conversationId?.trim()) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'targetUserId') ||
      typeof (body as { targetUserId?: unknown }).targetUserId !== 'string' ||
      !(body as { targetUserId: string }).targetUserId.trim()
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid group owner target')
    }

    const targetUserId = await resolveSocialProfileIdentityId(
      (body as { targetUserId: string }).targetUserId,
    )

    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/transfer-owner',
      method: 'POST',
      principal,
      body: { targetUserId },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
