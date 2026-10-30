import type { ContentPrincipal } from '../../../../../content/w03-content-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'
import {
  callW06PaymentMethodRevocationRequestAudit,
  W06ModerationClientError,
} from '../../../../../moderation/w06-moderation-client.js'

type RouteContext = { params: Promise<{ savedPaymentMethodId: string }> }

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validateIdempotencyKey(value: string | null): string | Response {
  const key = value?.trim() ?? ''
  if (!key) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
  if (key !== value || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
  }
  return key
}

async function authorizePaymentMethodRevocation(
  request: Request,
  principalUserId: string,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'payment_method.revoke.self',
      resourceType: 'PaymentMethod',
      resourceAttributes: { ownerId: principalUserId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = isRecord(value) ? value.decision : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Payment method revocation permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization response could not be verified')
}

async function revocationEventId(
  principalUserId: string,
  savedPaymentMethodId: string,
  idempotencyKey: string,
): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([principalUserId, savedPaymentMethodId, idempotencyKey]))
  const digest = await crypto.subtle.digest('SHA-256', input)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return 'evt_pm_revoke_requested_' + hex
}

function validRevocationEnvelope(value: unknown, savedPaymentMethodId: string): boolean {
  return isRecord(value) &&
    isRecord(value.data) &&
    value.data.savedPaymentMethodId === savedPaymentMethodId &&
    ['REVOCATION_PENDING', 'REMOVED'].includes(String(value.data.status)) &&
    typeof value.data.replayed === 'boolean' &&
    typeof value.requestId === 'string' && value.requestId.length > 0 && value.requestId.length <= 256
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { savedPaymentMethodId } = await context.params
    if (typeof savedPaymentMethodId !== 'string' || !/^spm_[A-Za-z0-9]{26}$/.test(savedPaymentMethodId)) {
      return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Saved payment method not found')
    }
    const idempotencyKey = validateIdempotencyKey(request.headers.get('Idempotency-Key'))
    if (idempotencyKey instanceof Response) return idempotencyKey
    if (request.body !== null) {
      await request.body.cancel().catch((): void => undefined)
      return errorResponse(400, 'VALIDATION_FAILED', 'Payment method removal does not accept a request body')
    }

    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePaymentMethodRevocation(request, principal.userId)
    if (denied) return denied

    const eventId = await revocationEventId(principal.userId, savedPaymentMethodId, idempotencyKey)
    let auditResponse: Response
    try {
      auditResponse = await callW06PaymentMethodRevocationRequestAudit({
        request,
        principal: principal as ContentPrincipal,
        body: { eventId, savedPaymentMethodId, idempotencyKey },
      })
    } catch {
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Payment method removal intent could not be durably recorded')
    }
    const auditValue: unknown = await auditResponse.clone().json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !isRecord(auditValue) ||
      auditValue.eventId !== eventId ||
      auditValue.action !== 'payment_method.revocation_requested' ||
      auditValue.targetType !== 'PaymentMethod' ||
      auditValue.targetId !== savedPaymentMethodId
    ) {
      if (auditResponse.status === 409) return errorResponse(409, 'CONFLICT', 'A conflicting payment method removal request already exists')
      return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Payment method removal intent was not durably confirmed')
    }

    const response = await callW07Subscription({
      request,
      pathname: '/payment-methods/' + encodeURIComponent(savedPaymentMethodId),
      method: 'DELETE',
      principal,
    })
    if (!response.ok) return response
    if (response.status !== 200 && response.status !== 202) {
      return errorResponse(503, 'PAYMENT_METHOD_RESPONSE_INVALID', 'Payment method removal result could not be verified')
    }
    const value: unknown = await response.clone().json().catch((): null => null)
    if (!validRevocationEnvelope(value, savedPaymentMethodId)) {
      return errorResponse(503, 'PAYMENT_METHOD_RESPONSE_INVALID', 'Payment method removal result could not be verified')
    }
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache' },
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W06ModerationClientError) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Payment method audit service unavailable')
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment method service unavailable')
  }
}
