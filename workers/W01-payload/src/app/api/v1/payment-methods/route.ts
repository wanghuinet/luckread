import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../subscription/w07-subscription-client.js'
import { callW08Creator, W08CreatorClientError } from '../../../../auth/w08-creator-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function authorizePaymentMethodRead(request: Request, principalUserId: string): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'payment_method.read.self',
      resourceType: 'PaymentMethod',
      resourceAttributes: { ownerId: principalUserId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = isRecord(value) ? value.decision : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Payment method read permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization response could not be verified')
}

function validPaymentMethodList(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.docs) ||
      typeof value.requestId !== 'string' || value.requestId.length < 1 || value.requestId.length > 256) return false
  return value.data.docs.length <= 100 && value.data.docs.every((entry) =>
    isRecord(entry) &&
    typeof entry.savedPaymentMethodId === 'string' &&
    /^spm_[A-Za-z0-9]{26}$/.test(entry.savedPaymentMethodId) &&
    typeof entry.paymentMethod === 'string' &&
    (entry.paymentMethodType === null || typeof entry.paymentMethodType === 'string') &&
    (entry.brand === null || typeof entry.brand === 'string') &&
    (entry.last4 === null || /^\d{4}$/.test(String(entry.last4))) &&
    (entry.expiryMonth === null || /^(0[1-9]|1[0-2])$/.test(String(entry.expiryMonth))) &&
    (entry.expiryYear === null || /^\d{2,4}$/.test(String(entry.expiryYear))) &&
    typeof entry.createdAt === 'string' &&
    typeof entry.recurringEnabled === 'boolean' &&
    ['ACTIVE', 'PENDING_PROVIDER_CONFIRMATION', 'REVOKED', 'FAILED', 'EXPIRED', 'NONE'].includes(String(entry.mandateStatus)) &&
    ['ACTIVE', 'SETUP_PENDING', 'NO_RECURRING', 'REVOCATION_PENDING'].includes(String(entry.status))
  )
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePaymentMethodRead(request, principal.userId)
    if (denied) return denied

    const response = await callW07Subscription({
      request,
      pathname: '/payment-methods',
      method: 'GET',
      principal,
    })
    if (!response.ok) return response
    const value: unknown = await response.clone().json().catch((): null => null)
    if (!validPaymentMethodList(value)) {
      return errorResponse(503, 'PAYMENT_METHOD_RESPONSE_INVALID', 'Saved payment method list could not be verified')
    }
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache' },
    })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W08CreatorClientError) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment method authorization unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment method service unavailable')
  }
}
