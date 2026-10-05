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

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    const { contentId } = await context.params
    if (!contentId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey || idempotencyKey.length > 256) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    }

    return await callW05Social({
      request,
      pathname: '/internal/social/content/' + encodeURIComponent(contentId) + '/shares',
      method: 'POST',
      principal,
      body: { contentId },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
