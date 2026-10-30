import {
  authorizePaymentReadPermission,
  mapOrderAdapterError,
  orderAdapterError,
} from '../../../../../commerce/w07-commerce-client.js'
import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../subscription/w07-subscription-client.js'
import { W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function listQuery(request: Request): string | Response {
  const url = new URL(request.url)
  for (const key of url.searchParams.keys()) {
    if (key !== 'limit' && key !== 'cursor') {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Unsupported billing query parameter')
    }
  }
  const limit = url.searchParams.get('limit')
  const cursor = url.searchParams.get('cursor')
  if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50)) {
    return orderAdapterError(400, 'VALIDATION_FAILED', 'Billing page size is invalid')
  }
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512)) {
    return orderAdapterError(400, 'VALIDATION_FAILED', 'Billing cursor is invalid')
  }
  const query = new URLSearchParams()
  if (limit !== null) query.set('limit', limit)
  if (cursor !== null) query.set('cursor', cursor)
  return query.size > 0 ? '?' + query.toString() : ''
}

function validEnvelope(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'data') || !Object.hasOwn(value, 'requestId') ||
      typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) return false
  const data = value.data
  if (!isRecord(data) || Object.keys(data).length !== 3 ||
      !Array.isArray(data.items) || data.items.length > 50 ||
      !(data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor.length <= 512)) ||
      typeof data.hasMore !== 'boolean') return false
  return data.items.every((item) => isRecord(item) &&
    typeof item.documentId === 'string' && item.documentId.length > 0 && item.documentId.length <= 128 &&
    (item.documentType === 'INVOICE' || item.documentType === 'RECEIPT') &&
    typeof item.documentNumber === 'string' && item.documentNumber.length > 0 && item.documentNumber.length <= 128 &&
    typeof item.orderId === 'string' && /^ord_[A-Za-z0-9_-]{1,90}$/.test(item.orderId) &&
    (item.paymentId === null || (typeof item.paymentId === 'string' && /^pay_[A-Za-z0-9]{26}$/.test(item.paymentId))) &&
    typeof item.amountMinor === 'number' && Number.isSafeInteger(item.amountMinor) && item.amountMinor > 0 &&
    typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency) &&
    isRecord(item.snapshot) &&
    typeof item.issuedAt === 'string' && typeof item.createdAt === 'string')
}

/** Immutable customer-owned invoice/receipt snapshots, returned without cardholder or provider secrets. */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePaymentReadPermission(request, principal)
    if (denied) return denied
    const query = listQuery(request)
    if (query instanceof Response) return query

    const response = await callW07Subscription({
      request,
      pathname: '/commerce/billing/documents' + query,
      method: 'GET',
      principal,
    })
    if (!response.ok) return response
    if (response.status !== 200 ||
        !validEnvelope(await response.clone().json().catch((): null => null))) {
      return orderAdapterError(503, 'BILLING_DOCUMENTS_RESPONSE_INVALID', 'Billing documents could not be verified')
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
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Billing authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
