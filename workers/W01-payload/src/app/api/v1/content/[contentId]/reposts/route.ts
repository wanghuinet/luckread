import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import {
  TrafficLimitError,
  enforceW01WriteRateLimit,
  rateLimitResponse,
} from '../../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status, headers: { 'cache-control': 'no-store' } },
)

async function mutateRepost(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const { contentId } = await context.params
    if (!contentId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content id')
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
    return await callW05Social({
      request,
      pathname: '/internal/social/content/' + encodeURIComponent(contentId) + '/reposts',
      method: request.method,
      principal,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function POST(request: Request, context: { params: Promise<{ contentId: string }> }): Promise<Response> {
  return mutateRepost(request, context)
}
export async function DELETE(request: Request, context: { params: Promise<{ contentId: string }> }): Promise<Response> {
  return mutateRepost(request, context)
}
