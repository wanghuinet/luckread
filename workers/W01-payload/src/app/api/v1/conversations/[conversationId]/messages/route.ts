import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

type RouteContext = { params: Promise<{ conversationId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    const url = new URL(request.url)
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/messages' + (url.search || ''),
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
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/messages',
      method: 'POST',
      principal,
      body,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
