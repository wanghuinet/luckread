import {
  authorizeOrderPermission,
  mapOrderAdapterError,
  orderAdapterError,
  readBoundedOrderBody,
  validateCreatedCommerceOrderEnvelope,
  validateOrderIdempotencyKey,
} from '../../../../../commerce/w07-commerce-client.js'
import { resolveCookieSubscriptionPrincipal, callW07Subscription, W07SubscriptionClientError } from '../../../../../subscription/w07-subscription-client.js'
import { callW06CommerceOrderAudit, W06ModerationClientError } from '../../../../../moderation/w06-moderation-client.js'
import { W08CreatorClientError } from '../../../../../auth/w08-creator-client.js'

/** W01 authenticates and authorizes order reads; the W07 D1-04 query repeats the principal owner scope. */
/** List only the current principal's orders; W07 independently applies the same owner predicate in D1-04. */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const allowedKeys = new Set(['cursor', 'limit']);
    for (const key of url.searchParams.keys()) {
      if (!allowedKeys.has(key)) return orderAdapterError(400, 'VALIDATION_FAILED', 'Unsupported order-list query parameter');
    }
    if (url.searchParams.getAll('limit').length > 1 || url.searchParams.getAll('cursor').length > 1) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Duplicate order-list query parameter');
    }
    const rawLimit = url.searchParams.get('limit');
    if (rawLimit !== null && (!/^[1-9][0-9]*$/.test(rawLimit) || Number(rawLimit) > 50)) {
      return orderAdapterError(400, 'VALIDATION_FAILED', 'Order-list limit is invalid');
    }
    const cursor = url.searchParams.get('cursor');
    if (cursor !== null && (!cursor || cursor.length > 2048)) {
      return orderAdapterError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
    }

    const principal = await resolveCookieSubscriptionPrincipal(request);
    if (principal instanceof Response) return principal;

    const denied = await authorizeOrderPermission(request, principal, 'order.read');
    if (denied) return denied;

    const query = new URLSearchParams();
    if (rawLimit !== null) query.set('limit', rawLimit);
    if (cursor !== null) query.set('cursor', cursor);
    const suffix = query.size ? '?' + query.toString() : '';
    return await callW07Subscription({
      request,
      pathname: '/commerce/orders' + suffix,
      method: 'GET',
      principal,
    });
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return orderAdapterError(error.status, error.code, error.message);
    }
    if (error instanceof W08CreatorClientError) {
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable');
    }
    return mapOrderAdapterError(error);
  }
}

/** W01 authenticates and authorizes order creation, then requires W06 durable audit confirmation for every successful W07 result. */
export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const denied = await authorizeOrderPermission(request, principal, 'order.create')
    if (denied) return denied

    const idempotencyKey = validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))
    if (idempotencyKey instanceof Response) return idempotencyKey

    const parsed = await readBoundedOrderBody(request)
    if (parsed.ok === false) return parsed.response

    const w07Response = await callW07Subscription({
      request,
      pathname: '/commerce/orders',
      method: 'POST',
      principal,
      body: parsed.value,
    })
    if (!w07Response.ok) return w07Response
    if (w07Response.status !== 200 && w07Response.status !== 201) {
      return orderAdapterError(503, 'ORDER_RESPONSE_INVALID', 'Order result could not be verified')
    }

    const order = validateCreatedCommerceOrderEnvelope(await w07Response.clone().json().catch((): null => null))
    if (!order) return orderAdapterError(503, 'ORDER_RESPONSE_INVALID', 'Order result could not be verified')

    const auditResponse = await callW06CommerceOrderAudit({ request, principal, body: order })
    const auditResult: unknown = await auditResponse.json().catch((): null => null)
    if (
      (auditResponse.status !== 200 && auditResponse.status !== 201) ||
      !auditResult || typeof auditResult !== 'object' ||
      (auditResult as { eventId?: unknown }).eventId !== order.eventId ||
      (auditResult as { action?: unknown }).action !== 'commerce.order.created' ||
      (auditResult as { targetType?: unknown }).targetType !== 'Order' ||
      (auditResult as { targetId?: unknown }).targetId !== order.orderId
    ) {
      return orderAdapterError(503, 'AUDIT_UNAVAILABLE', 'Order audit was not durably confirmed')
    }
    return w07Response
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) {
      return orderAdapterError(error.status, error.code, error.message)
    }
    if (error instanceof W06ModerationClientError) {
      return orderAdapterError(503, 'AUDIT_UNAVAILABLE', 'Order audit service unavailable')
    }
    if (error instanceof W08CreatorClientError) {
      return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Order authorization unavailable')
    }
    return mapOrderAdapterError(error)
  }
}
