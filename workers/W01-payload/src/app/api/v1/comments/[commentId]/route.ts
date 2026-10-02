import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function DELETE(
  request: Request,
  context: { params: Promise<{ commentId: string }> },
): Promise<Response> {
  try {
    const { commentId } = await context.params
    if (!commentId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid comment id')

    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    return await callW05Social({
      request,
      pathname: '/internal/social/comments/' + encodeURIComponent(commentId),
      method: 'DELETE',
      principal,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
