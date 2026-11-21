import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    return await callW05Social({
      request,
      pathname: '/internal/social/notifications' + (url.search ? url.search : ''),
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
