import {
  authorizeOrderPermission,
  mapOrderAdapterError,
  orderAdapterError,
} from '../../../../../commerce/w07-commerce-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

type RouteContext = { params: Promise<{ refundId: string }> }

const REFUND_ID_PATTERN = /^ref_[A-Za-z0-9]{26}$/
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/
const REFUND_STATUSES = new Set(['INITIATING', 'pending', 'succeeded', 'failed', 'review'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validRefundDto(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 10) return false
  return (
    typeof value.refundId === 'string' && REFUND_ID_PATTERN.test(value.refundId) &&
    typeof value.paymentId === 'string' && PAYMENT_ID_PATTERN.test(value.paymentId) &&
    typeof value.amountMinor === 'number' && Number.isSafeInteger(value.amountMinor) && value.amountMinor > 0 &&
    typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency) &&
    (value.reason === null || (typeof value.reason === 'string' && value.reason.length <= 255)) &&
    typeof value.status === 'string' && REFUND_STATUSES.has(value.status) &&
    typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version >= 1 &&
    (value.providerUpdatedAt === null || validTimestamp(value.providerUpdatedAt)) &&
    validTimestamp(value.createdAt) && validTimestamp(value.updatedAt)
  )
}

function validateRefundEnvelope(value: unknown, expectedRefundId: string): boolean {
  return isRecord(value) && Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'data') && Object.hasOwn(value, 'requestId') &&
    typeof value.requestId === 'string' && /^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId) &&
    isRecord(value.data) && Object.keys(value.data).length === 2 &&
    isRecord(value.data.refund) && value.data.refund.refundId === expectedRefundId &&
    validRefundDto(value.data.refund) && value.data.statusAuthority === 'W07_D1_04'
}

/** Read only the signed-in customer's own refund status through W01 -> W07. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { refundId } = await context.params
    if (typeof refundId !== 'string' || !REFUND_ID_PATTERN.test(refundId)) {
      return orderAdapterError(404, 'RESOURCE_NOT_FOUND', 'Refund not found')
    }
    if (new URL(request.url).search || request.body !== null) {
      if (request.body !== null) await request.body.cancel().catch(() => undefined)
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Refund status does not accept query parameters or a request body')
    }
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizeOrderPermission(request, principal, 'order.read')
    if (denied) return denied

    const response = await callW07Subscription({
      request,
      pathname: '/refunds/' + encodeURIComponent(refundId),
      method: 'GET',
      principal,
    })
    if (!response.ok) return response
    const payload: unknown = await response.clone().json().catch((): null => null)
    if (response.status !== 200 || !validateRefundEnvelope(payload, refundId)) {
      return orderAdapterError(503, 'REFUND_RESPONSE_INVALID', 'Refund status could not be verified')
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
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Refund authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
