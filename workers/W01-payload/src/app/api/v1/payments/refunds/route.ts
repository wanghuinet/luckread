import {
  authorizePaymentRefundPermission,
  mapOrderAdapterError,
  orderAdapterError,
  readBoundedOrderBody,
  validateOrderIdempotencyKey,
} from '../../../../../commerce/w07-commerce-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validateRefundEnvelope(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'data') || !Object.hasOwn(value, 'requestId') ||
      typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) {
    return false
  }
  const data = value.data
  if (!isRecord(data) || Object.keys(data).length !== 13) return false
  return (
    typeof data.refundId === 'string' && /^ref_[A-Za-z0-9]{26}$/.test(data.refundId) &&
    typeof data.paymentId === 'string' && /^pay_[A-Za-z0-9]{26}$/.test(data.paymentId) &&
    typeof data.orderId === 'string' && /^ord_[A-Za-z0-9_-]{1,90}$/.test(data.orderId) &&
    typeof data.amountMinor === 'number' && Number.isSafeInteger(data.amountMinor) && data.amountMinor >= 100 &&
    typeof data.capturedAmountMinor === 'number' && Number.isSafeInteger(data.capturedAmountMinor) &&
    data.capturedAmountMinor >= data.amountMinor &&
    typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) &&
    ['REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REVIEW', 'RECONCILIATION_REQUIRED'].includes(String(data.status)) &&
    (data.reason === null || (typeof data.reason === 'string' && data.reason.length <= 255)) &&
    typeof data.version === 'number' && Number.isSafeInteger(data.version) && data.version >= 1 &&
    (data.providerUpdatedAt === null || typeof data.providerUpdatedAt === 'string') &&
    typeof data.createdAt === 'string' && typeof data.updatedAt === 'string' &&
    typeof data.replayed === 'boolean'
  )
}

/**
 * Public customer refund entry. W01 authenticates the W02 cookie session and
 * asks W08 for the own-Payment refund permission before relaying the request.
 * W07 independently reloads the payment by (payment_id, customer_id), verifies
 * captured funds through Hyperswitch and reserves a stable refund_id in D1-04.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const denied = await authorizePaymentRefundPermission(request, principal)
    if (denied) return denied

    const idempotencyKey = validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))
    if (idempotencyKey instanceof Response) return idempotencyKey
    if (idempotencyKey.length > 128) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
    }

    const parsed = await readBoundedOrderBody(request)
    if (parsed.ok === false) return parsed.response
    if (
      !isRecord(parsed.value) ||
      Object.keys(parsed.value).some((key) => !['paymentId', 'amountMinor', 'currency', 'reason'].includes(key)) ||
      Object.keys(parsed.value).length < 3 ||
      typeof parsed.value.paymentId !== 'string' ||
      !/^pay_[A-Za-z0-9]{26}$/.test(parsed.value.paymentId) ||
      typeof parsed.value.amountMinor !== 'number' ||
      !Number.isSafeInteger(parsed.value.amountMinor) ||
      parsed.value.amountMinor < 100 ||
      typeof parsed.value.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(parsed.value.currency) ||
      (parsed.value.reason !== undefined && (
        typeof parsed.value.reason !== 'string' ||
        parsed.value.reason.length > 255 ||
        parsed.value.reason.trim() !== parsed.value.reason ||
        /[\u0000-\u001f\u007f]/.test(parsed.value.reason)
      ))
    ) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Refund payment, amount, currency and reason are invalid')
    }

    const response = await callW07Subscription({
      request,
      pathname: '/commerce/payments/refunds',
      method: 'POST',
      principal,
      body: parsed.value,
    })
    if (!response.ok) return response
    if (
      (response.status !== 200 && response.status !== 202) ||
      !validateRefundEnvelope(await response.clone().json().catch((): null => null))
    ) {
      return orderAdapterError(503, 'REFUND_RESPONSE_INVALID', 'Refund request could not be verified')
    }
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    headers.set('pragma', 'no-cache')
    return new Response(response.body, { status: response.status, headers })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return orderAdapterError(error.status, error.code, error.message)
    }
    if (error instanceof W08CreatorClientError) {
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
