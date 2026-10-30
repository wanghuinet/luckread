import {
  authorizeOrderPermission,
  mapOrderAdapterError,
  orderAdapterError,
  readBoundedOrderBody,
  validateOrderIdempotencyKey,
} from '../../../../../../commerce/w07-commerce-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'

type RouteContext = { params: Promise<{ paymentId: string }> }

const REFUND_ID_PATTERN = /^ref_[A-Za-z0-9]{26}$/
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const REFUND_STATUSES = new Set(['INITIATING', 'pending', 'succeeded', 'failed', 'review'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validRefundDto(value: unknown, expectedPaymentId: string): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 10) return false
  return (
    typeof value.refundId === 'string' && REFUND_ID_PATTERN.test(value.refundId) &&
    value.paymentId === expectedPaymentId &&
    typeof value.amountMinor === 'number' && Number.isSafeInteger(value.amountMinor) && value.amountMinor > 0 &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) &&
    (value.reason === null || (typeof value.reason === 'string' && value.reason.length <= 255)) &&
    typeof value.status === 'string' && REFUND_STATUSES.has(value.status) &&
    typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version >= 1 &&
    (value.providerUpdatedAt === null || validTimestamp(value.providerUpdatedAt)) &&
    validTimestamp(value.createdAt) && validTimestamp(value.updatedAt)
  )
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validateRefundEnvelope(value: unknown, expectedPaymentId: string): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'data') || !Object.hasOwn(value, 'requestId') ||
      typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId) ||
      !isRecord(value.data) || Object.keys(value.data).length !== 3 ||
      !Object.hasOwn(value.data, 'refund') ||
      typeof value.data.replayed !== 'boolean' ||
      value.data.statusAuthority !== 'W07_D1_04') return false
  return validRefundDto(value.data.refund, expectedPaymentId)
}

/** Customer refund request. W01 authorizes an L2+ owner; W07 rechecks D1-04 and actual captured funds. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { paymentId } = await context.params
    if (typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId)) {
      return orderAdapterError(404, 'RESOURCE_NOT_FOUND', 'Payment not found')
    }
    if (new URL(request.url).search) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Refund request does not accept query parameters')
    }
    const idempotencyKey = validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))
    if (idempotencyKey instanceof Response) return idempotencyKey

    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizeOrderPermission(request, principal, 'order.refund.self')
    if (denied) return denied

    const parsed = await readBoundedOrderBody(request)
    if (parsed.ok === false) return parsed.response
    if (
      !isRecord(parsed.value) ||
      !Object.hasOwn(parsed.value, 'amountMinor') ||
      Object.keys(parsed.value).some((key) => key !== 'amountMinor' && key !== 'reason') ||
      typeof parsed.value.amountMinor !== 'number' ||
      !Number.isSafeInteger(parsed.value.amountMinor) ||
      parsed.value.amountMinor <= 0 ||
      (parsed.value.reason !== undefined && parsed.value.reason !== null &&
        (typeof parsed.value.reason !== 'string' || parsed.value.reason.length < 1 ||
         parsed.value.reason.length > 255 || parsed.value.reason.trim() !== parsed.value.reason ||
         /[\u0000-\u001f\u007f]/.test(parsed.value.reason)))
    ) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'A positive amountMinor and optional reason are required')
    }

    const response = await callW07Subscription({
      request,
      pathname: '/payments/' + encodeURIComponent(paymentId) + '/refunds',
      method: 'POST',
      principal,
      body: {
        amountMinor: parsed.value.amountMinor,
        ...(parsed.value.reason !== undefined ? { reason: parsed.value.reason } : {}),
      },
    })
    if (!response.ok) return response
    const payload: unknown = await response.clone().json().catch((): null => null)
    if (
      (response.status !== 200 && response.status !== 201) ||
      !validateRefundEnvelope(payload, paymentId)
    ) {
      return orderAdapterError(503, 'REFUND_RESPONSE_INVALID', 'Refund request result could not be verified')
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
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Refund authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
