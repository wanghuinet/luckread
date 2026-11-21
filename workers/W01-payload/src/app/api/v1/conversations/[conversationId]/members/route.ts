import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ conversationId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/members',
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'memberUserIds')) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid member payload')
    }
    const ids = (body as { memberUserIds?: unknown }).memberUserIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 49 || ids.some(id => typeof id !== 'string')) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid group member list')
    }
    const memberUserIds = await Promise.all((ids as string[]).map(resolveSocialProfileIdentityId))
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/members',
      method: 'POST',
      principal,
      body: { memberUserIds },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
