import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ conversationId: string }> }

async function proxy(request: Request, context: RouteContext, method: 'GET' | 'POST'): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid conversation id')
    let body: unknown
    if (method === 'POST') {
      try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'typing') || typeof (body as {typing?:unknown}).typing !== 'boolean') return errorResponse(422, 'VALIDATION_FAILED', 'Invalid typing payload')
    }
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/typing',
      method,
      principal,
      ...(method === 'POST' ? { body } : {}),
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
export async function GET(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context, 'GET') }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context, 'POST') }
