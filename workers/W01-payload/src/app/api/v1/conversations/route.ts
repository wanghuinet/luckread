import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
} from '../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations' + (url.search || ''),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { recipientUserId?: unknown }).recipientUserId !== 'string') {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid recipient user id')
    }
    const recipientUserId = await resolveSocialProfileIdentityId((body as { recipientUserId: string }).recipientUserId)
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations',
      method: 'POST',
      principal,
      body: { recipientUserId },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
