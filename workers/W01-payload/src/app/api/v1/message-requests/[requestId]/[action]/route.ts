import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string; action: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { requestId, action } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestId) ||
      !['accept', 'decline', 'cancel'].includes(action)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid message request action')
    }
    return await callW05Social({
      request,
      pathname: '/internal/messaging/requests/' + encodeURIComponent(requestId) + '/' + action,
      method: 'POST',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Message requests unavailable')
  }
}
