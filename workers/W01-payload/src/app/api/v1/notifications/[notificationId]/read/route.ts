import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function POST(
  request: Request,
  context: { params: Promise<{ notificationId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { notificationId } = await context.params
    if (!notificationId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid notification id')
    return await callW05Social({
      request,
      pathname: '/internal/social/notifications/' + encodeURIComponent(notificationId) + '/read',
      method: 'POST',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
