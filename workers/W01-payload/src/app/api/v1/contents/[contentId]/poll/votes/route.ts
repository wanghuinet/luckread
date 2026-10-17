import { resolveCookieSocialPrincipal, W05SocialClientError, callW05Social } from '../../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { contentId } = await context.params
    if (!contentId.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content id')
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll vote request') }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof (body as { optionId?: unknown }).optionId !== 'string'
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid poll vote request')
    }
    return await callW05Social({
      request,
      pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/poll/votes',
      method: 'POST',
      principal,
      body: { optionId: (body as { optionId: string }).optionId },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social poll service unavailable')
  }
}
