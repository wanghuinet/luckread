import { callW08Creator, W08CreatorClientError } from '../auth/w08-creator-client.js'
import type { ContentPrincipal } from '../content/w03-content-client.js'

export type OrderPermission = 'order.create' | 'order.read'

/** Subscriber-owned plan changes require the canonical W08 CASL own-scope grant. */
export async function authorizeSubscriptionChangePlanPermission(
  request: Request,
  principal: ContentPrincipal,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Subscription plan change permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization response could not be verified')
}

const errorResponse = (status: number, code: string, message: string): Response =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

/** W08 derives actor/layer/account state from the W02 session; W01 supplies only the server-derived owner scope. */
export async function authorizeOrderPermission(
  request: Request,
  principal: ContentPrincipal,
  action: OrderPermission,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action,
      resourceType: 'Order',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Order permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization response could not be verified')
}

export type BoundedOrderBody = { ok: true; value: unknown } | { ok: false; response: Response }

export async function readBoundedOrderBody(request: Request): Promise<BoundedOrderBody> {
  const maxBytes = 16_384
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A JSON order body is required') }
  }
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'Order request is too large or malformed') }
  }
  if (!request.body) return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A JSON order body is required') }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'Order request is too large') }
      }
      chunks.push(part.value)
    }
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON order body is required') }
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  } catch {
    return { ok: false, response: errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON order body is required') }
  }
}

export function validateOrderIdempotencyKey(value: string | null): string | Response {
  const key = value?.trim() ?? ''
  if (!key) return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
  if (key.length > 256 || key !== value || /[\u0000-\u001f\u007f]/.test(key)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid')
  }
  return key
}

export type CreatedCommerceOrderAudit = Readonly<{
  eventId: string
  orderId: string
  occurredAt: string
  status: 'CREATED'
  version: number
  currency: string
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))

const safeMinor = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Validate the complete public Order DTO before using any fields in a durable audit record. */
export function validateCreatedCommerceOrderEnvelope(value: unknown): CreatedCommerceOrderAudit | null {
  if (!isRecord(value) || !hasExactKeys(value, ['data', 'requestId'])) return null
  if (typeof value.requestId !== 'string' || !/^req_[A-Za-z0-9_-]{1,123}$/.test(value.requestId)) return null
  if (!isRecord(value.data) || !hasExactKeys(value.data, [
    'orderId', 'status', 'version', 'currency', 'subtotalMinor', 'discountMinor',
    'taxMinor', 'totalMinor', 'items', 'createdAt', 'updatedAt',
  ])) return null

  const order = value.data
  if (
    typeof order.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(order.orderId) ||
    order.status !== 'CREATED' ||
    typeof order.version !== 'number' || !Number.isSafeInteger(order.version) || order.version < 1 ||
    typeof order.currency !== 'string' || !/^[A-Z]{3}$/.test(order.currency) ||
    !safeMinor(order.subtotalMinor) || !safeMinor(order.discountMinor) ||
    !safeMinor(order.taxMinor) || !safeMinor(order.totalMinor) ||
    order.discountMinor > order.subtotalMinor ||
    !Number.isSafeInteger(order.subtotalMinor - order.discountMinor + order.taxMinor) ||
    order.totalMinor !== order.subtotalMinor - order.discountMinor + order.taxMinor ||
    typeof order.createdAt !== 'string' || !Number.isFinite(Date.parse(order.createdAt)) ||
    typeof order.updatedAt !== 'string' || !Number.isFinite(Date.parse(order.updatedAt)) ||
    !Array.isArray(order.items) || order.items.length < 1 || order.items.length > 50
  ) return null

  let subtotal = 0
  let discount = 0
  let tax = 0
  let total = 0
  for (const entry of order.items) {
    if (!isRecord(entry) || !hasExactKeys(entry, [
      'itemRef', 'quantity', 'unitAmountMinor', 'lineSubtotalMinor',
      'lineDiscountMinor', 'lineTaxMinor', 'lineTotalMinor',
    ])) return null
    if (
      typeof entry.itemRef !== 'string' || entry.itemRef.length < 1 || entry.itemRef.length > 255 ||
      entry.itemRef !== entry.itemRef.trim() || /[\u0000-\u001f\u007f]/.test(entry.itemRef) ||
      typeof entry.quantity !== 'number' || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 10_000 ||
      !safeMinor(entry.unitAmountMinor) || !safeMinor(entry.lineSubtotalMinor) ||
      !safeMinor(entry.lineDiscountMinor) || !safeMinor(entry.lineTaxMinor) || !safeMinor(entry.lineTotalMinor)
    ) return null
    const expectedSubtotal = entry.unitAmountMinor * entry.quantity
    const expectedTotal = entry.lineSubtotalMinor - entry.lineDiscountMinor + entry.lineTaxMinor
    if (
      !Number.isSafeInteger(expectedSubtotal) || entry.lineSubtotalMinor !== expectedSubtotal ||
      entry.lineDiscountMinor > entry.lineSubtotalMinor ||
      !Number.isSafeInteger(expectedTotal) || entry.lineTotalMinor !== expectedTotal
    ) return null
    subtotal += entry.lineSubtotalMinor
    discount += entry.lineDiscountMinor
    tax += entry.lineTaxMinor
    total += entry.lineTotalMinor
    if (![subtotal, discount, tax, total].every(Number.isSafeInteger)) return null
  }
  if (
    subtotal !== order.subtotalMinor || discount !== order.discountMinor ||
    tax !== order.taxMinor || total !== order.totalMinor
  ) return null

  return {
    eventId: 'evt_order_created_' + order.orderId,
    orderId: order.orderId,
    occurredAt: order.createdAt,
    status: 'CREATED',
    version: order.version,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    totalMinor: order.totalMinor,
  }
}

export function orderAdapterError(status: number, code: string, message: string): Response {
  return errorResponse(status, code, message)
}

export function mapOrderAdapterError(error: unknown): Response {
  if (error instanceof W08CreatorClientError) {
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable')
  }
  return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Order service unavailable')
}


/**
 * Refund permission is checked against the Payment subject, not Order. W07
 * independently resolves payment ownership from D1-04 before provider access.
 */
export async function authorizePaymentRefundPermission(
  request: Request,
  principal: ContentPrincipal,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Payment refund permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment authorization response could not be verified')
}


/** Customer-owned payment history is read through W08's own-Payment permission. */
export async function authorizePaymentReadPermission(
  request: Request,
  principal: ContentPrincipal,
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'payment.read',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })
  const response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  const decision = value && typeof value === 'object'
    ? (value as { data?: { decision?: unknown } }).data?.decision
    : undefined
  if (decision === 'ALLOW') return null
  if (decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Payment read permission required')
  return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Payment authorization response could not be verified')
}
