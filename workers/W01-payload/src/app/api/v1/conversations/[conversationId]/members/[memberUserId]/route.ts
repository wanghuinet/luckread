import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
} from '../../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ conversationId: string; memberUserId: string }> }

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId, memberUserId } = await context.params
    if (!conversationId?.trim() || !memberUserId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid group member reference')
    const canonicalMemberId = await resolveSocialProfileIdentityId(memberUserId)
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) +
        '/members/' + encodeURIComponent(canonicalMemberId),
      method: 'DELETE',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
