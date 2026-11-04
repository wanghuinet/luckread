import {
  callW05Social,
  resolveSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { TrafficLimitError, enforceW01WriteAccountRateLimit, enforceW01WriteEndpointRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

async function forwardPushEndpoint(
  request: Request,
  context: { params: Promise<{ installationId: string }> },
  method: 'PUT' | 'DELETE',
): Promise<Response> {
  try {
    // Edge/IP and origin guards run before the authenticated principal lookup.
    await enforceW01WriteRateLimit(request)
    const principal = await resolveSocialPrincipal(request)
    if (principal instanceof Response) return principal
    await enforceW01WriteAccountRateLimit(principal.userId)
    await enforceW01WriteEndpointRateLimit(method === 'PUT' ? 'upsertPushEndpoint' : 'deletePushEndpoint')
    await enforceW01WriteAccountRateLimit(principal.userId)
    await enforceW01WriteEndpointRateLimit('push-endpoint-registration')

    const { installationId } = await context.params
    if (!installationId?.trim() || installationId.length > 64) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid installation id')
    }

    let body: unknown
    if (method === 'PUT') {
      try { body = await request.json() } catch {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid push endpoint request')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid push endpoint request')
      }
    }

    return await callW05Social({
      request,
      pathname: '/internal/social/push-endpoints/' + encodeURIComponent(installationId),
      method,
      principal,
      ...(method === 'PUT' ? { body } : {}),
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ installationId: string }> },
): Promise<Response> {
  return forwardPushEndpoint(request, context, 'PUT')
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ installationId: string }> },
): Promise<Response> {
  return forwardPushEndpoint(request, context, 'DELETE')
}
