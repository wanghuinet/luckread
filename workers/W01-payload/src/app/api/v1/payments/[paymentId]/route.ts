import {
  authorizeOrderPermission,
  mapOrderAdapterError,
  orderAdapterError,
} from '../../../../../../commerce/w07-commerce-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'

type RouteContext = { params: Promise<{ paymentId: string }> }

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const PAYMENT_STATUSES = new Set([
  'INITIATING',
  'requires_payment_method',
  'requires_confirmation',
  'requires_customer_action',
  'requires_merchant_action',
  'requires_capture',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'cancelled_post_capture',
  'partially_captured',
  'partially_captured_and_capturable',
  'expired',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

/** Validate the complete safe payment-status envelope before releasing it publicly. */
function validatePaymentStatusEnvelope(value: unknown, expectedPaymentId: string): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'data') || !Object.hasOwn(value, 'requestId')) return false
  if (typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) return false
  if (!isRecord(value.data) || Object.keys(value.data).length !== 5) return false
  const data = value.data
  if (
    !Object.hasOwn(data, 'payment') ||
    !Object.hasOwn(data, 'providerStatus') ||
    !Object.hasOwn(data, 'providerStatusCheck') ||
    !Object.hasOwn(data, 'providerCheckedAt') ||
    data.statusAuthority !== 'W07_D1_04' ||
    !isRecord(data.payment) ||
    Object.keys(data.payment).length !== 9
  ) return false

  const payment = data.payment
  if (
    payment.paymentId !== expectedPaymentId ||
    typeof payment.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(payment.orderId) ||
    typeof payment.amountMinor !== 'number' || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0 ||
    typeof payment.currency !== 'string' || !/^[A-Z]{3}$/.test(payment.currency) ||
    typeof payment.status !== 'string' || !PAYMENT_STATUSES.has(payment.status) ||
    typeof payment.version !== 'number' || !Number.isSafeInteger(payment.version) || payment.version < 1 ||
    !(payment.providerUpdatedAt === null || validTimestamp(payment.providerUpdatedAt)) ||
    !validTimestamp(payment.createdAt) ||
    !validTimestamp(payment.updatedAt)
  ) return false

  const providerStatus = data.providerStatus
  const providerCheck = data.providerStatusCheck
  if (!(providerStatus === null || (typeof providerStatus === 'string' && PAYMENT_STATUSES.has(providerStatus) && providerStatus !== 'INITIATING'))) {
    return false
  }
  if (!['MATCH', 'DIFFERS', 'UNAVAILABLE'].includes(String(providerCheck))) return false
  if (!(data.providerCheckedAt === null || validTimestamp(data.providerCheckedAt))) return false
  if (providerCheck === 'MATCH' && (providerStatus === null || providerStatus !== payment.status || data.providerCheckedAt === null)) return false
  if (providerCheck === 'DIFFERS' && (providerStatus === null || providerStatus === payment.status || data.providerCheckedAt === null)) return false
  if (providerCheck === 'UNAVAILABLE' && providerStatus !== null) return false
  return true
}

/**
 * Public read for the current principal's payment. W01 authorizes order.read;
 * W07 independently scopes D1-04 by the same server-derived customer ID.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { paymentId } = await context.params
    if (typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId)) {
      return orderAdapterError(404, 'RESOURCE_NOT_FOUND', 'Payment not found')
    }
    if (new URL(request.url).search) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Payment status does not accept query parameters')
    }
    if (request.body !== null) {
      await request.body.cancel().catch(() => undefined)
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Payment status does not accept a request body')
    }

    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const denied = await authorizeOrderPermission(request, principal, 'order.read')
    if (denied) return denied

    const response = await callW07Subscription({
      request,
      pathname: '/payments/' + encodeURIComponent(paymentId),
      method: 'GET',
      principal,
    })
    if (!response.ok) return response
    const payload: unknown = await response.clone().json().catch((): null => null)
    if (response.status !== 200 || !validatePaymentStatusEnvelope(payload, paymentId)) {
      return orderAdapterError(503, 'PAYMENT_STATUS_RESPONSE_INVALID', 'Payment status could not be verified')
    }
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    headers.set('pragma', 'no-cache')
    return new Response(response.body, { status: 200, headers })
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
