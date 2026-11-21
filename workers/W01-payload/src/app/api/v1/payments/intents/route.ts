import {
  authorizeOrderPermission,
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

function validatePaymentIntentEnvelope(value: unknown, expectedOrderId: string): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'data') || !Object.hasOwn(value, 'requestId')) return false
  if (typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) return false
  const data = value.data
  if (!isRecord(data) || Object.keys(data).length !== 9) return false
  if (
    typeof data.paymentId !== 'string' || !/^pay_[a-f0-9]{26}$/.test(data.paymentId) ||
    data.orderId !== expectedOrderId ||
    typeof data.amountMinor !== 'number' || !Number.isSafeInteger(data.amountMinor) || data.amountMinor <= 0 ||
    typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency) ||
    (data.pricingMode !== 'live' && data.pricingMode !== 'demo') ||
    (data.status !== 'requires_payment_method' && data.status !== 'requires_confirmation') ||
    typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1 ||
    typeof data.clientSecret !== 'string' || data.clientSecret.length < 1 || data.clientSecret.length > 4096 ||
    data.clientSecret.trim() !== data.clientSecret || /[\u0000-\u001f\u007f]/.test(data.clientSecret) ||
    typeof data.sdkAuthorization !== 'string' || data.sdkAuthorization.length < 1 || data.sdkAuthorization.length > 4096 ||
    data.sdkAuthorization.trim() !== data.sdkAuthorization || /[\u0000-\u001f\u007f]/.test(data.sdkAuthorization)
  ) return false
  return true
}

/**
 * Public checkout entry. W01 derives the session principal and authorizes
 * order ownership before relaying the bounded order ID through the existing
 * private W07 service binding. Price, currency, merchant credentials and
 * provider status are never accepted from the browser.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const denied = await authorizeOrderPermission(request, principal, 'order.read')
    if (denied) return denied

    const idempotencyKey = validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))
    if (idempotencyKey instanceof Response) return idempotencyKey

    const parsed = await readBoundedOrderBody(request)
    if (parsed.ok === false) return parsed.response
    if (
      !isRecord(parsed.value) ||
      Object.keys(parsed.value).length !== 1 ||
      typeof parsed.value.orderId !== 'string' ||
      !/^ord_[A-Za-z0-9_-]{1,90}$/.test(parsed.value.orderId)
    ) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'A valid orderId is required')
    }

    const orderId = parsed.value.orderId
    const response = await callW07Subscription({
      request,
      pathname: '/commerce/orders/' + encodeURIComponent(orderId) + '/payment-intent',
      method: 'POST',
      principal,
    })
    if (!response.ok) return response
    if (
      (response.status !== 200 && response.status !== 201) ||
      !validatePaymentIntentEnvelope(await response.clone().json().catch((): null => null), orderId)
    ) {
      return orderAdapterError(503, 'PAYMENT_INTENT_RESPONSE_INVALID', 'Payment intent could not be verified')
    }
    // clientSecret is a narrowly scoped SDK credential. Do not cache it or log it.
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    headers.set('pragma', 'no-cache')
    return new Response(response.body, { status: response.status, headers })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return orderAdapterError(error.status, error.code, error.message)
    }
    if (error instanceof W08CreatorClientError) {
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
