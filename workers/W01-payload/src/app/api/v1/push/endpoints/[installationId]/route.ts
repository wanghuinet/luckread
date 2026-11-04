import {
  callW05Social,
  resolveSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import { TrafficLimitError, enforceW01WriteAccountRateLimit, enforceW01WriteEndpointRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )


async function authorizePushEndpoint(request: Request, principal: { userId: string; layer: string | null }): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'notification.update.self',
      resourceType: 'Notification',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })

  let response: Response
  try {
    response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  } catch (error) {
    if (error instanceof W08CreatorClientError) {
      return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization unavailable')
    }
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization unavailable')
  }
  if (!response.ok) {
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization unavailable')
  }

  const value: unknown = await response.json().catch((): null => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization response could not be verified')
  }
  const result = value as Record<string, unknown>
  if (result.decision === 'DENY') {
    return errorResponse(403, 'PERMISSION_DENIED', 'Notification endpoint permission required')
  }
  if (
    result.decision !== 'ALLOW' ||
    result.action !== 'notification.update.self' ||
    result.resourceType !== 'Notification' ||
    result.policyVersion !== 'casl-l0-l8-v1' ||
    result.layer !== principal.layer
  ) {
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization response could not be verified')
  }
  return null
}

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
    const authorizationDenied = await authorizePushEndpoint(request, principal)
    if (authorizationDenied) return authorizationDenied

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
