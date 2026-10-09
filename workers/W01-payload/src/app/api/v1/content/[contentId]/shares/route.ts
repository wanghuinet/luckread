import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { rememberPublicShareContentId } from '../../../../../../lib/public-response-cache.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
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
    if (!contentId?.trim()) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid content id')

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    if (idempotencyKey.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')

    const response = await callW05Social({
      request,
      pathname: '/internal/social/content/' + encodeURIComponent(contentId) + '/shares',
      method: 'POST',
      principal,
      body: { contentId },
    })
    if (response.ok) {
      try {
        const payload = await response.clone().json() as {
          data?: { shareId?: unknown; contentId?: unknown }
        }
        if (typeof payload.data?.shareId === 'string' && typeof payload.data?.contentId === 'string') {
          await rememberPublicShareContentId(payload.data.shareId, payload.data.contentId)
        }
      } catch {
        // Share creation is authoritative; cache metadata is best-effort.
      }
    }
    return response
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
