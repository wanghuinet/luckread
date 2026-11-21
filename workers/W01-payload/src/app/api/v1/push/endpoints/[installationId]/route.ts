import {
  callW05Social,
  resolveSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'
import { callW06PushEndpointMutationAudit, W06ModerationClientError } from '../../../../../../moderation/w06-moderation-client.js'
import { TrafficLimitError, enforceW01WriteAccountRateLimit, enforceW01WriteEndpointRateLimit, enforceW01WriteRateLimit, rateLimitResponse } from '../../../../../../auth/traffic-limit.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )



const validIdempotencyKey = (value: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed === value && /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null
}

async function pushEndpointAuditEventId(
  userId: string,
  installationId: string,
  operation: 'REGISTER' | 'REMOVE',
  idempotencyKey: string,
): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([userId, installationId, operation, idempotencyKey]))
  const digest = await crypto.subtle.digest('SHA-256', input)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'evt_push_endpoint_' + hex
}

async function persistPushEndpointMutationIntent(input: {
  request: Request
  principal: { userId: string; layer: string | null; verified?: boolean }
  installationId: string
  operation: 'REGISTER' | 'REMOVE'
  idempotencyKey: string
  platform: 'ios' | 'android' | null
  permissionStatus: 'granted' | 'denied' | 'undetermined' | null
}): Promise<Response | null> {
  const eventId = await pushEndpointAuditEventId(input.principal.userId, input.installationId, input.operation, input.idempotencyKey)
  let response: Response
  try {
    response = await callW06PushEndpointMutationAudit({
      request: input.request,
      principal: input.principal,
      body: {
        eventId,
        installationId: input.installationId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        platform: input.platform,
        permissionStatus: input.permissionStatus,
      },
    })
  } catch {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Push endpoint mutation intent could not be durably recorded')
  }
  const value: unknown = await response.clone().json().catch((): null => null)
  if (
    (response.status !== 200 && response.status !== 201) ||
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (value as Record<string, unknown>).eventId !== eventId ||
    (value as Record<string, unknown>).action !== 'notification.push_endpoint.mutation_requested' ||
    (value as Record<string, unknown>).targetType !== 'NotificationPushEndpoint' ||
    (value as Record<string, unknown>).targetId !== input.installationId
  ) {
    if (response.status === 409) return errorResponse(409, 'CONFLICT', 'A conflicting push endpoint mutation request already exists')
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Push endpoint mutation intent was not durably confirmed')
  }
  return null
}

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
    const { installationId } = await context.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installationId)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid installation id')
    }
    const rawIdempotencyKey = request.headers.get('Idempotency-Key')
    const idempotencyKey = validIdempotencyKey(rawIdempotencyKey)
    if (!rawIdempotencyKey) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    if (!idempotencyKey) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key')

    let body: unknown
    let platform: 'ios' | 'android' | null = null
    let permissionStatus: 'granted' | 'denied' | 'undetermined' | null = null
    if (method === 'PUT') {
      try { body = await request.json() } catch {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid push endpoint request')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid push endpoint request')
      }
      const registration = body as Record<string, unknown>
      if (
        (registration.platform !== 'ios' && registration.platform !== 'android') ||
        !['granted', 'denied', 'undetermined'].includes(String(registration.permissionStatus))
      ) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid push endpoint request')
      platform = registration.platform
      permissionStatus = registration.permissionStatus as 'granted' | 'denied' | 'undetermined'
    }

    const authorizationDenied = await authorizePushEndpoint(request, principal)
    if (authorizationDenied) return authorizationDenied

    const auditDenied = await persistPushEndpointMutationIntent({
      request,
      principal,
      installationId,
      operation: method === 'PUT' ? 'REGISTER' : 'REMOVE',
      idempotencyKey,
      platform,
      permissionStatus,
    })
    if (auditDenied) return auditDenied

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
    if (error instanceof W08CreatorClientError || error instanceof W06ModerationClientError) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Push endpoint authorization or audit service unavailable')
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
