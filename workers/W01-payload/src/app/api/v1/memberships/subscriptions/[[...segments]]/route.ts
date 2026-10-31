import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'
import {
  authorizeSubscriptionChangePlanPermission,
  orderAdapterError,
  readBoundedOrderBody,
  validateCreatedCommerceOrderEnvelope,
  validateOrderIdempotencyKey,
} from '../../../../../../commerce/w07-commerce-client.js'
import { callW06CommerceOrderAudit, W06ModerationClientError } from '../../../../../../moderation/w06-moderation-client.js'
import { W08CreatorClientError } from '../../../../../../auth/w08-creator-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string; body?: unknown } | Response | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'GET') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  if (parts.length === 2 && method === 'POST' && parts[1] === 'change-plan') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan' }
  if (parts.length === 3 && method === 'GET' && parts[1] === 'change-plan' && parts[2] === 'quote') {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan/quote' }
  }
  return null
}


async function forward(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const operation = resolveOperation(request.method, params.segments)
    if (!operation) return new Response(null, { status: 404 })
    if (operation instanceof Response) return operation
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    if (request.method === 'POST') {
      const segments = params.segments ?? []
      if (segments.length !== 2 || segments[1] !== 'change-plan') {
        return errorResponse(
          503,
          'SERVICE_UNAVAILABLE',
          'This subscription write is not enabled.',
        )
      }

      const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
      if (!/^"lr-v([1-9]\d*)"$/.test(ifMatch) || ifMatch.length > 256) {
        return errorResponse(428, 'PRECONDITION_REQUIRED', 'A valid If-Match subscription version is required')
      }
      const idempotencyKey = validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))
      if (idempotencyKey instanceof Response) return idempotencyKey

      const denied = await authorizeSubscriptionChangePlanPermission(request, principal)
      if (denied) return denied

      const parsed = await readBoundedOrderBody(request)
      if (parsed.ok === false) return parsed.response
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value) ||
          Object.keys(parsed.value).length !== 1 ||
          typeof (parsed.value as { planId?: unknown }).planId !== 'string' ||
          !/^plan_[a-f0-9]{64}$/.test((parsed.value as { planId: string }).planId)) {
        return orderAdapterError(400, 'VALIDATION_FAILED', 'A valid target planId is required')
      }

      const w07Response = await callW07Subscription({
        request,
        pathname: operation.pathname,
        method: 'POST',
        principal,
        body: parsed.value,
      })
      if (!w07Response.ok) return w07Response
      if (w07Response.status !== 200 && w07Response.status !== 201) {
        return orderAdapterError(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Subscription plan change result could not be verified')
      }

      const envelope: unknown = await w07Response.clone().json().catch((): null => null)
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        return orderAdapterError(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Subscription plan change result could not be verified')
      }
      const responseValue = envelope as Record<string, unknown>
      const checkout = responseValue.data
      if (typeof responseValue.requestId !== 'string' ||
          !/^req_[A-Za-z0-9_-]{1,123}$/.test(responseValue.requestId) ||
          !checkout || typeof checkout !== 'object' || Array.isArray(checkout)) {
        return orderAdapterError(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Subscription plan change result could not be verified')
      }
      const data = checkout as Record<string, unknown>
      if (data.status !== 'PAYMENT_REQUIRED' || data.paymentRequired !== true ||
          typeof data.changeRequestId !== 'string' || !/^scr_[a-f0-9]{60}$/.test(data.changeRequestId) ||
          typeof data.replayed !== 'boolean' ||
          data.paymentIntentPath !== '/api/v1/payments/intents') {
        return orderAdapterError(503, 'PLAN_CHANGE_RESPONSE_INVALID', 'Subscription plan change result could not be verified')
      }
      const order = validateCreatedCommerceOrderEnvelope({
        data: data.order,
        requestId: responseValue.requestId,
      })
      if (!order || order.totalMinor <= 0) {
        return orderAdapterError(503, 'PLAN_CHANGE_ORDER_INVALID', 'Subscription upgrade order could not be verified')
      }

      const auditResponse = await callW06CommerceOrderAudit({
        request,
        principal,
        body: order,
      })
      const auditValue: unknown = await auditResponse.json().catch((): null => null)
      if (
        (auditResponse.status !== 200 && auditResponse.status !== 201) ||
        !auditValue || typeof auditValue !== 'object' ||
        (auditValue as { eventId?: unknown }).eventId !== order.eventId ||
        (auditValue as { action?: unknown }).action !== 'commerce.order.created' ||
        (auditValue as { targetType?: unknown }).targetType !== 'Order' ||
        (auditValue as { targetId?: unknown }).targetId !== order.orderId
      ) {
        return orderAdapterError(503, 'AUDIT_UNAVAILABLE', 'Subscription upgrade order audit was not durably confirmed')
      }
      return w07Response
    }
    const segments = params.segments ?? []
    const forwardsQuery = request.method === 'GET' && (
      segments.length === 0 || (segments.length === 3 && segments[1] === 'change-plan' && segments[2] === 'quote')
    )
    const pathname = forwardsQuery ? operation.pathname + new URL(request.url).search : operation.pathname
    return await callW07Subscription({ request, pathname, method: 'GET', principal })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W06ModerationClientError) return orderAdapterError(503, 'AUDIT_UNAVAILABLE', 'Subscription order audit unavailable')
    if (error instanceof W08CreatorClientError) return orderAdapterError(503, 'AUTHORIZATION_UNAVAILABLE', 'Subscription authorization unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
